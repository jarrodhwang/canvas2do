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
            own = alice.call("/api/academy/preferences", headers={"X-Canvas-To-Do-Owner-Key": "user:" + ids['alice']})
            other = bob.call("/api/academy/preferences", headers={"X-Canvas-To-Do-Owner-Key": "user:" + ids['bob']})
            assert own['manualLectures'][0]['name'] == 'CMPT276' and not other['manualLectures']
            preview = admin.call(target + "/data/preferences")
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
