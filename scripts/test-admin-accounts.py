#!/usr/bin/env python3
"""Run account-management regression checks against an isolated temporary PostgreSQL/API.

Usage: python3 scripts/test-admin-accounts.py /absolute/path/to/CanvasToDo.Api.dll
Requires PostgreSQL 18 binaries and dotnet; never connects to the project database.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def call(self, path, method="GET", body=None, expected=200, headers=None):
        fields = {"Content-Type": "application/json", "X-Canvas-To-Do-Request": "1", **(headers or {})}
        request = urllib.request.Request(self.base + path,
            data=json.dumps(body).encode() if body is not None else None, headers=fields, method=method)
        try:
            response = self.opener.open(request)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read().decode()
        assert response.status == expected, f"{method} {path}: expected {expected}, got {response.status}: {raw}"
        return json.loads(raw) if raw else None

    def login(self, email, password, expected=200):
        return self.call("/api/auth/login", "POST", {"email": email, "password": password}, expected)


def main():
    dll = Path(sys.argv[1]).resolve(strict=True)
    pg_bin = Path(os.environ.get("TEST_PG_BIN", "/usr/lib/postgresql/18/bin"))
    pg_port, api_port = free_port(), free_port()
    while api_port == pg_port:
        api_port = free_port()
    with tempfile.TemporaryDirectory(prefix="canvas-account-tests-") as directory:
        root = Path(directory)
        pg_data = root / "postgres"
        subprocess.run([str(pg_bin / "initdb"), "-D", str(pg_data), "-A", "trust", "-U", "account_test"],
            check=True, stdout=subprocess.DEVNULL)
        subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(pg_data), "-l", str(root / "postgres.log"),
            "-o", f"-h 127.0.0.1 -p {pg_port} -k {directory}", "-w", "start"], check=True, stdout=subprocess.DEVNULL)
        process = None
        log = tempfile.TemporaryFile()
        env = dict(os.environ, ASPNETCORE_ENVIRONMENT="Development", ASPNETCORE_URLS=f"http://127.0.0.1:{api_port}",
            ConnectionStrings__CanvasToDo=f"Host=127.0.0.1;Port={pg_port};Database=postgres;Username=account_test",
            Database__EnsureCreated="true", Database__MigrateAuth="true", Database__InitializeOnStartup="true",
            Authentication__Admin__BootstrapEmail="admin@example.test", Authentication__Admin__BootstrapPassword="TestOnlyAdmin123!",
            Authentication__Google__ClientId="", Authentication__Facebook__ClientId="",
            Email__PublicFrontendBaseUrl=f"http://127.0.0.1:{api_port}", Email__Development__ExposeTokens="true",
            Authentication__Canvas__AllowedOrigins="https://sfu.instructure.com,https://canvas.ubc.ca,https://canvas.usask.ca,https://canvas.uw.edu,https://canvas.stanford.edu,https://canvas.harvard.edu,https://canvas.example.edu",
            Authentication__Canvas__Schools__0__InstanceUrl="https://canvas.example.edu",
            Authentication__Canvas__Schools__0__Name="Example University",
            Authentication__Canvas__ManualTokenEnabled="true", DataProtection__KeysPath=str(root / "keys"),
            Logging__LogLevel__Default="Warning", AllowedHosts="*")
        base = f"http://127.0.0.1:{api_port}"

        def sql(statement):
            return subprocess.run([str(pg_bin / 'psql'), '-h', '127.0.0.1', '-p', str(pg_port), '-U', 'account_test',
                '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True, check=True).stdout.strip()

        def start():
            nonlocal process
            process = subprocess.Popen(["dotnet", str(dll)], cwd=directory, env=env, stdout=log, stderr=log)
            for _ in range(100):
                if process.poll() is not None:
                    log.seek(0)
                    raise AssertionError(log.read().decode())
                try:
                    Client(base).call("/api/health/ready")
                    return
                except (urllib.error.URLError, AssertionError):
                    time.sleep(.1)
            raise AssertionError("Temporary API did not become ready")

        def restart():
            process.terminate()
            process.wait(timeout=10)
            start()

        try:
            start()
            admin, alice, bob, anonymous = [Client(base) for _ in range(4)]
            admin.login("admin@example.test", "TestOnlyAdmin123!")
            for name in ("alice", "bob"):
                anonymous.call("/api/auth/signup", "POST", {"displayName": name, "email": f"{name}@example.test", "password": "OriginalTest123!"}, 202)
            people = admin.call("/api/admin/users")["users"]
            ids = {person["email"].split("@")[0]: person["id"] for person in people}
            alice.login("alice@example.test", "OriginalTest123!", 403)
            for name in ("alice", "bob"):
                admin.call(f"/api/admin/users/{ids[name]}", "PATCH", {"status": "active"})
            alice.login("alice@example.test", "OriginalTest123!")
            bob.login("bob@example.test", "OriginalTest123!")
            target = f"/api/admin/users/{ids['alice']}"
            anonymous.call(target, expected=401)
            bob.call(target, expected=403)
            bob.call(target + "/data/preferences", "PUT", {"calendarSettings": {"themeMode": "light"}}, 403)
            print("PASS administrator-only routes and pending-account activation")

            admin.call(target + "/data/preferences", "PUT", {"calendarSettings": {"themeMode": "light", "selectedSemester": "Summer 2026"},
                "manualLectures": [{"id": "manual-276", "name": "CMPT276"}], "manualCoursework": [{"id": "todo-1", "title": "Private task"}]})
            before = admin.call(target)
            assert before.get('lastActiveAt') is None, 'Login and administrator edits must not count as target activity'
            own = alice.call("/api/academy/preferences", headers={"X-Canvas-To-Do-Owner-Key": "user:" + ids['alice']})
            other = bob.call("/api/academy/preferences", headers={"X-Canvas-To-Do-Owner-Key": "user:" + ids['bob']})
            assert own['manualLectures'][0]['name'] == 'CMPT276' and not other['manualLectures']
            active = admin.call(target)
            assert active['lastActiveAt'] is not None
            assert active['lastLoginAt'] == before['lastLoginAt'], 'Activity must not change last login'
            alice.call('/api/academy/preferences', headers={'X-Canvas-To-Do-Owner-Key': 'user:' + ids['alice']})
            assert admin.call(target)['lastActiveAt'] == active['lastActiveAt'], 'Activity writes are throttled'
            sql(f"""UPDATE auth_users SET "LastActiveAt" = NOW() - INTERVAL '2 minutes' WHERE "Id" = '{ids['alice']}'""")
            alice.call('/api/academy/preferences', headers={'X-Canvas-To-Do-Owner-Key': 'user:' + ids['alice']})
            refreshed = admin.call(target)['lastActiveAt']
            assert refreshed >= active['lastActiveAt'], 'Continued app use refreshes activity'
            preview = admin.call(target + "/data/preferences")
            assert admin.call(target)['lastActiveAt'] == refreshed, 'Admin previews must not refresh target activity'
            listed = next(user for user in admin.call('/api/admin/users')['users'] if user['id'] == ids['alice'])
            assert listed['lastActiveAt'] == refreshed
            print("PASS last activity tracking, login separation, throttling, and administrator attribution")
            assert preview == own
            assert admin.call('/api/auth/session')['email'] == 'admin@example.test'
            admin.call(target + '/data/calendar', 'POST', {}, 405)
            assert 'accessToken' not in json.dumps(admin.call(target + '/data/canvas-token'))
            admin.call(target + '/data/canvas-token', 'PUT', {'instanceUrl': 'http://127.0.0.1', 'accessToken': 'test'}, 400)
            admin.call(target + '/data/preferences', 'PUT', {'calendarSettings': {'themeMode': 'dark'}})
            assert admin.call(target + '/data/preferences')['manualCoursework'] == own['manualCoursework']
            admin.call(target + '/data/preferences', 'PUT', {'manualLectures': []}, 403, headers={'X-Canvas-To-Do-Request': ''})
            schools = alice.call('/api/canvas/token', headers={'X-Canvas-To-Do-Owner-Key': 'user:' + ids['alice']})['schools']
            assert {school['name']: school['instanceUrl'] for school in schools} == {
                'Simon Fraser University': 'https://sfu.instructure.com',
                'University of British Columbia': 'https://canvas.ubc.ca',
                'University of Saskatchewan': 'https://canvas.usask.ca',
                'University of Washington': 'https://canvas.uw.edu',
                'Stanford University': 'https://canvas.stanford.edu',
                'Harvard University': 'https://canvas.harvard.edu',
                'Example University': 'https://canvas.example.edu',
            }
            print("PASS school dropdown catalog follows allowed origins and configured school names")
            print("PASS target isolation, read-only preview, partial settings preservation, Canvas allowlist")

            alice.call('/api/auth/profile', 'PATCH', {'newPassword': 'BypassTest123!', 'currentPassword': 'OriginalTest123!'}, 409)
            anonymous.call('/api/auth/change-password', 'POST', {'newPassword': 'OwnPassword123!', 'confirmPassword': 'OwnPassword123!'}, 401)
            other_alice = Client(base)
            other_alice.login('alice@example.test', 'OriginalTest123!')
            own_change = {'currentPassword': 'WrongPassword123!', 'newPassword': 'ImmediateChange123!', 'confirmPassword': 'ImmediateChange123!'}
            alice.call('/api/auth/change-password', 'POST', own_change, 400)
            own_change['currentPassword'] = 'OriginalTest123!'
            alice.call('/api/auth/change-password', 'POST', {**own_change, 'confirmPassword': 'Mismatch123!'}, 400)
            alice.call('/api/auth/change-password', 'POST', {**own_change, 'newPassword': 'short', 'confirmPassword': 'short'}, 400)
            alice.call('/api/auth/change-password', 'POST', own_change)
            assert alice.call('/api/auth/session')['isAuthenticated']
            assert not other_alice.call('/api/auth/session')['isAuthenticated']
            assert admin.call(target).get('passwordRequest') is None
            alice.login('alice@example.test', 'OriginalTest123!', 401)
            alice.login('alice@example.test', 'ImmediateChange123!')
            print("PASS immediate Settings password change, current-password validation, refreshed own session, other-session revocation")

            restart()
            reset_path = '/api/auth/reset-password/request'
            reset_body = {'email': 'alice@example.test', 'newPassword': 'NewPasswordTest123!', 'confirmPassword': 'NewPasswordTest123!'}
            anonymous.call(reset_path, 'POST', {**reset_body, 'confirmPassword': 'Mismatch123!'}, 400)
            unknown = anonymous.call(reset_path, 'POST', {**reset_body, 'email': 'unknown@example.test'}, 202)
            submitted = anonymous.call(reset_path, 'POST', reset_body, 202)
            assert unknown == submitted and 'request' not in submitted
            pending = admin.call(target)['passwordRequest']
            assert pending['source'] == 'sign-in-reset'
            duplicate = anonymous.call(reset_path, 'POST', {**reset_body, 'newPassword': 'UntrustedReplacement123!', 'confirmPassword': 'UntrustedReplacement123!'}, 202)
            assert duplicate == submitted and admin.call(target)['passwordRequest']['id'] == pending['id']
            anonymous.call(reset_path, 'POST', {**reset_body, 'email': 'another-unknown@example.test'}, 202)
            anonymous.call(reset_path, 'POST', reset_body, 429)
            stored = sql(f'''SELECT "Value" FROM auth_user_tokens WHERE "UserId" = '{ids['alice']}' AND "LoginProvider" = 'CanvasToDo.PasswordChange';''')
            assert 'NewPasswordTest123!' not in stored and json.loads(stored)['PasswordHash']
            detail = admin.call(target)
            assert 'PasswordHash' not in json.dumps(detail) and 'NewPasswordTest123!' not in json.dumps(detail)
            alice.login('alice@example.test', 'NewPasswordTest123!', 401)
            alice.login('alice@example.test', 'ImmediateChange123!')
            assert next(p for p in admin.call('/api/admin/users')['users'] if p['id'] == ids['alice'])['passwordRequest']['status'] == 'pending'
            bob.call(target + '/password-request/review', 'POST', {'requestId': pending['id'], 'approve': True}, 403)
            admin.call(target + '/password-request/review', 'POST', {'requestId': pending['id'], 'approve': True})
            stored = sql(f'''SELECT "Value" FROM auth_user_tokens WHERE "UserId" = '{ids['alice']}' AND "LoginProvider" = 'CanvasToDo.PasswordChange';''')
            assert json.loads(stored)['PasswordHash'] is None
            assert not alice.call('/api/auth/session')['isAuthenticated']
            alice.login('alice@example.test', 'ImmediateChange123!', 401)
            alice.login('alice@example.test', 'NewPasswordTest123!')
            admin.call(target + '/password-request/review', 'POST', {'requestId': pending['id'], 'approve': True}, 409)
            print("PASS public reset request, generic responses, rate limiting, pending-request preservation, approval, hash secrecy, replay rejection")

            restart()
            anonymous.call(reset_path, 'POST', {**reset_body, 'newPassword': 'RejectedRequest123!', 'confirmPassword': 'RejectedRequest123!'}, 202)
            pending = admin.call(target)['passwordRequest']
            admin.call(target + '/password-request/review', 'POST', {'requestId': pending['id'], 'approve': False})
            alice.login('alice@example.test', 'NewPasswordTest123!')
            anonymous.call(reset_path, 'POST', {**reset_body, 'newPassword': 'DiscardThis123!', 'confirmPassword': 'DiscardThis123!'}, 202)
            pending = admin.call(target)['passwordRequest']
            alice.call('/api/auth/change-password', 'POST', {'currentPassword': 'NewPasswordTest123!', 'newPassword': 'OwnAfterRequest123!', 'confirmPassword': 'OwnAfterRequest123!'})
            assert admin.call(target).get('passwordRequest') is None
            admin.call(target + '/password-request/review', 'POST', {'requestId': pending['id'], 'approve': True}, 409)
            anonymous.call(reset_path, 'POST', reset_body, 202)
            pending = admin.call(target)['passwordRequest']
            admin.call(target + '/password', 'POST', {'newPassword': 'short', 'confirmPassword': 'short'}, 400)
            admin.call(target + '/password', 'POST', {'newPassword': 'AdminReplacement123!', 'confirmPassword': 'AdminReplacement123!'})
            assert not alice.call('/api/auth/session')['isAuthenticated']
            admin.call(target + '/password-request/review', 'POST', {'requestId': pending['id'], 'approve': True}, 409)
            alice.login('alice@example.test', 'AdminReplacement123!')
            print("PASS rejection and immediate user/admin changes invalidate pending requests")

            admin.call(target, 'PATCH', {'email': 'bob@example.test'}, 409)
            admin.call(target, 'PATCH', {'displayName': 'Alice Updated', 'phoneNumber': '+1 555 0100', 'email': 'alice.updated@example.test', 'status': 'active'})
            assert not alice.call('/api/auth/session')['isAuthenticated']
            alice.login('alice.updated@example.test', 'AdminReplacement123!')
            detail = admin.call(target)
            assert detail['displayName'] == 'Alice Updated' and detail['phoneNumber'] == '+1 555 0100'
            print("PASS profile updates, unique email enforcement, and email-change session revocation")

            restart()
            reset = anonymous.call('/api/auth/forgot-password', 'POST', {'email': 'alice.updated@example.test'}, 202)
            params = urllib.parse.parse_qs(urllib.parse.urlparse(reset['developmentActionUrl']).fragment)
            request = anonymous.call('/api/auth/reset-password', 'POST', {'email': params['email'][0], 'code': params['code'][0],
                'newPassword': 'RecoveryRequest123!', 'confirmPassword': 'RecoveryRequest123!'}, 202)
            assert request['request']['status'] == 'pending'
            assert request['request']['source'] == 'email-verified-reset'
            alice.login('alice.updated@example.test', 'AdminReplacement123!')
            print("PASS email recovery also requires administrator approval")

            # Reject a request after a security-stamp change (e.g. explicit session revocation).
            admin.call(target + '/revoke-sessions', 'POST', {}, 204)
            admin.call(target + '/password-request/review', 'POST', {'requestId': request['request']['id'], 'approve': True}, 409)
            assert admin.call(target)['passwordRequest']['status'] == 'expired'
            print("PASS stale password requests cannot restore a credential after revocation")

            anonymous.call(reset_path, 'POST', {'email': 'bob@example.test', 'userId': ids['alice'], 'newPassword': 'BobRequest123!', 'confirmPassword': 'BobRequest123!'}, 202)
            pending = admin.call(f"/api/admin/users/{ids['bob']}")['passwordRequest']
            sql(f'''UPDATE auth_user_tokens SET "Value" = jsonb_set("Value"::jsonb, '{{RequestedAt}}', to_jsonb(now() - interval '8 days'))::text
                WHERE "UserId" = '{ids['bob']}' AND "LoginProvider" = 'CanvasToDo.PasswordChange';''')
            admin.call(f"/api/admin/users/{ids['bob']}/password-request/review", 'POST', {'requestId': pending['id'], 'approve': True}, 409)
            assert admin.call(f"/api/admin/users/{ids['bob']}")['passwordRequest']['status'] == 'expired'
            assert admin.call(target)['passwordRequest']['id'] != pending['id']
            print("PASS seven-day expiry and user request ownership cannot be overridden")
            restart()
            bob.login('bob@example.test', 'OriginalTest123!')
            mode_target = f"/api/admin/users/{ids['bob']}"
            owner = {'X-Canvas-To-Do-Owner-Key': 'user:' + ids['bob']}
            mode_path = '/api/canvas/manual-mode'
            confirms = {'leavingCanvasPermanently': True, 'understandsIrreversible': True, 'understandsApprovalDelay': True}
            anonymous.call(mode_path, expected=401)
            bob.call(mode_path, expected=401, headers={'X-Canvas-To-Do-Owner-Key': 'user:' + ids['alice']})
            assert bob.call(mode_path, headers=owner)['request'] is None
            bob.call(mode_path, 'POST', confirms, 409, headers=owner)
            fixtures = {
                'manualLectures': [{'id': 'manual-1', 'name': 'Manual course', 'code': 'CMPT 100', 'semester': 'Fall 2026'}],
                'manualCoursework': [
                    {'id': 'manual-task', 'title': 'Essay', 'courseCode': 'CMPT 100', 'semester': 'Fall 2026'},
                    {'id': 'different-term', 'title': 'Old essay', 'courseCode': 'CMPT 100', 'semester': 'Fall 2025'}],
                'manualAssessments': [{'id': 'exam', 'courseCode': 'CMPT 100', 'semester': 'Fall 2026'}],
                'canvasLecturePreferences': {'42': {'courseName': 'Saved Canvas course', 'originalCourseCode': 'CMPT 200',
                    'lastSeenAt': '2026-09-11T01:00:00Z', 'semester': 'School Trimester B', 'currentScore': 85,
                    'schedule': {'deliveryMode': 'inPerson', 'day': '', 'time': '', 'location': '', 'entries': []}}},
                'canvasCourseworkPreferences': {'canvas-assignment-42-7': {'courseId': '42', 'title': 'Saved assignment', 'semester': 'School Trimester B', 'completed': True}},
                'calendarSettings': {'selectedSemester': 'Fall 2026', 'canvasTokenPromptEnabled': False}}
            admin.call(mode_target + '/data/preferences', 'PUT', fixtures)
            before_mode = bob.call('/api/academy/preferences', headers=owner)
            bob.call('/api/canvas/courses', expected=409, headers=owner)
            assert bob.call('/api/academy/preferences', headers=owner) == before_mode, 'Missing token must never trigger conversion'
            token_json = json.dumps({'instanceUrl': 'https://sfu.instructure.com', 'protectedAccessToken': 'invalid-test-ciphertext', 'tokenSource': 'user'})
            sql(f'''INSERT INTO user_settings ("Id", "CreatedAt", "UpdatedAt", "UserKey", "SettingKey", "SettingJson")
                VALUES (gen_random_uuid(), now(), now(), 'user:{ids['bob']}', 'canvas.token', '{token_json}'::jsonb);''')
            assert bob.call('/api/canvas/token', headers=owner)['status'] == 'invalid'
            bob.call('/api/canvas/courses', expected=409, headers=owner)
            assert bob.call('/api/academy/preferences', headers=owner) == before_mode
            term_path = '/api/academy/courses/manual-1/term'
            anonymous.call(term_path, 'PUT', {'year': 2026, 'term': 'Winter'}, 401)
            bob.call(term_path, 'PUT', {'year': 1999, 'term': 'Spring'}, 400, headers=owner)
            bob.call(term_path, 'PUT', {'year': 3000, 'term': 'Spring'}, 400, headers=owner)
            bob.call(term_path, 'PUT', {'year': 2026, 'term': 'Invalid'}, 400, headers=owner)
            bob.call('/api/academy/courses/42/term', 'PUT', {'year': 2026, 'term': 'Winter'}, 409, headers=owner)
            moved = bob.call(term_path, 'PUT', {'year': 2000, 'term': 'Winter'}, headers=owner)
            assert moved['manualLectures'][0]['semester'] == 'Winter 2000'
            assert moved['manualCoursework'][0]['semester'] == 'Winter 2000'
            assert moved['manualAssessments'][0]['semester'] == 'Winter 2000'
            assert moved['manualCoursework'][1]['semester'] == 'Fall 2025'
            print('PASS manual term validation, atomic linked-item moves and Canvas course protection')
            bob.call(mode_path, 'POST', {**confirms, 'understandsIrreversible': False}, 400, headers=owner)
            pending = bob.call(mode_path, 'POST', confirms, headers=owner)
            assert pending['status'] == 'pending'
            assert bob.call(mode_path, 'POST', confirms, headers=owner)['id'] == pending['id']
            assert bob.call('/api/academy/preferences', headers=owner)['canvasLecturePreferences']['42'].get('convertedToManualAt') is None
            review_path = mode_target + '/manual-mode/review'
            bob.call(review_path, 'POST', {'requestId': pending['id'], 'approve': True}, 403)
            anonymous.call(review_path, 'POST', {'requestId': pending['id'], 'approve': True}, 401)
            assert next(user for user in admin.call('/api/admin/users')['users'] if user['id'] == ids['bob'])['manualModeRequestPending']
            declined = admin.call(review_path, 'POST', {'requestId': pending['id'], 'approve': False})
            assert declined['status'] == 'rejected'
            admin.call(review_path, 'POST', {'requestId': pending['id'], 'approve': True}, 409)
            pending = bob.call(mode_path, 'POST', confirms, headers=owner)
            restart()
            assert bob.call(mode_path, headers=owner)['request']['id'] == pending['id'], 'Request persists across restart'
            approved = admin.call(review_path, 'POST', {'requestId': pending['id'], 'approve': True})
            assert approved['status'] == 'approved' and approved['reviewedBy'] == ids['admin']
            saved = bob.call('/api/academy/preferences', headers=owner)
            converted = next(course for course in saved['manualLectures'] if course['id'] == 'manual-canvas-42')
            assert converted['name'] == 'Saved Canvas course' and converted['canvasGradeSummary']['score'] == 85
            assert converted['semester'] == 'School Trimester B'
            assert saved['canvasCourseworkPreferences']['canvas-assignment-42-7']['completed']
            assert not saved['calendarSettings']['canvasTokenPromptEnabled']
            assert sql(f'''SELECT count(*) FROM user_settings WHERE "UserKey" = 'user:{ids['bob']}' AND "SettingKey" = 'canvas.token';''') == '0'
            assert bob.call('/api/canvas/token', headers=owner)['status'] == 'manual_mode'
            bob.call('/api/canvas/token', 'PUT', {'instanceUrl': 'https://sfu.instructure.com', 'accessToken': 'never-send-this'}, 409, headers=owner)
            admin.call(mode_target + '/data/canvas-token', 'PUT', {'instanceUrl': 'https://sfu.instructure.com', 'accessToken': 'never-send-this'}, 409)
            bob.call('/api/canvas/oauth/login', expected=409)
            bob.call('/api/canvas/courses', expected=409, headers=owner)
            bob.call('/api/academy/preferences', 'PUT', fixtures, 409, headers=owner)
            admin.call(review_path, 'POST', {'requestId': pending['id'], 'approve': True}, 409)
            moved = bob.call('/api/academy/courses/manual-canvas-42/term', 'PUT', {'year': 2026, 'term': 'Summer'}, headers=owner)
            assert next(course for course in moved['manualLectures'] if course['id'] == 'manual-canvas-42')['semester'] == 'Summer 2026'
            assert moved['canvasCourseworkPreferences']['canvas-assignment-42-7']['semester'] == 'Summer 2026'
            restart()
            assert bob.call('/api/canvas/token', headers=owner)['status'] == 'manual_mode'
            print('PASS permanent manual mode confirmations, ownership, approval, persistence, retained grades/tasks, stale writes and reconnection guards')
            print("All account-management integration checks passed.")
        finally:
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
            log.close()
            subprocess.run([str(pg_bin / "pg_ctl"), '-D', str(pg_data), '-m', 'fast', '-w', 'stop'],
                check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
