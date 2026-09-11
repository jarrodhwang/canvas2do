import { useEffect, useState } from 'react';
import { ArrowLeft, Eye, RefreshCw, ShieldCheck } from 'lucide-react';
import { canvasToDoApi, type AcademyPreferences, type AdminUser, type CanvasTokenStatus, type ManualModeRequest, type PasswordChangeStatus } from '../api/canvasToDoApi';
import { Button } from './ui/button';
import { Input } from './ui/input';

type Tab = 'profile' | 'password' | 'settings' | 'canvas' | 'preview';
type Props = { userId: string; preview: boolean; initialTab?: 'password' | 'canvas'; onClose: () => void; onSaved: () => void };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

function PreviewRecords({ title, rows }: { title: string; rows: unknown[] }) {
  return <section className="grid gap-2">
    <h3 className="font-bold">{title} · {rows.length}</h3>
    {!rows.length && <p className="text-sm text-muted-foreground">No saved items.</p>}
    {rows.map((value, index) => {
      const row = object(value);
      const name = text(row.title ?? row.name ?? row.courseCode ?? row.code ?? row.id) || `Item ${index + 1}`;
      const summary = [row.courseName, row.courseCode, row.semester, row.termName, row.dueAt ?? row.dueDate, row.score, row.grade, row.isCompleted === true ? 'Completed' : null]
        .map(text).filter(Boolean).join(' · ');
      return <details className="rounded-lg border p-3" key={index}>
        <summary className="cursor-pointer text-sm font-semibold">{name}{summary && <span className="ml-2 font-normal text-muted-foreground">{summary}</span>}</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre>
      </details>;
    })}
  </section>;
}

export function AdminUserDetails({ userId, preview, initialTab, onClose, onSaved }: Props) {
  const base = `/admin/users/${encodeURIComponent(userId)}`;
  const [tab, setTab] = useState<Tab>(preview ? 'preview' : initialTab ?? 'profile');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [preferences, setPreferences] = useState<AcademyPreferences | null>(null);
  const [token, setToken] = useState<CanvasTokenStatus | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [settingsJson, setSettingsJson] = useState('');
  const [theme, setTheme] = useState('dark');
  const [semester, setSemester] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [instanceUrl, setInstanceUrl] = useState('https://sfu.instructure.com');
  const [accessToken, setAccessToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [liveCourses, setLiveCourses] = useState<unknown[]>([]);
  const [liveCalendar, setLiveCalendar] = useState<unknown[]>([]);
  const [liveMessage, setLiveMessage] = useState('Live Canvas data has not been loaded.');

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      canvasToDoApi.accountRequest<AdminUser>(base),
      canvasToDoApi.accountRequest<AcademyPreferences>(`${base}/data/preferences`),
      canvasToDoApi.accountRequest<CanvasTokenStatus>(`${base}/data/canvas-token`),
    ]).then(([account, prefs, connection]) => {
      if (!active) return;
      if (account.status === 'fulfilled') {
        setUser(account.value); setName(account.value.displayName); setEmail(account.value.email); setPhone(account.value.phoneNumber ?? '');
      }
      if (prefs.status === 'fulfilled') {
        setPreferences(prefs.value); setSettingsJson(JSON.stringify(prefs.value, null, 2));
        const settings = object(prefs.value.calendarSettings);
        setTheme(text(settings.themeMode) || 'dark'); setSemester(text(settings.selectedSemester));
      }
      if (connection.status === 'fulfilled') {
        setToken(connection.value); setInstanceUrl(connection.value.instanceUrl ?? 'https://sfu.instructure.com');
      }
      setError([account, prefs, connection].flatMap(result => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : 'Unable to load account data.'] : []).join(' '));
      setLoading(false);
    });
    return () => { active = false; };
  }, [base, revision]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await action()); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update this account.'); }
    finally { setBusy(false); }
  };
  const saveSettings = async (value: unknown) => {
    const data = object(value);
    if (!Object.keys(data).length) throw new Error('Enter a settings object.');
    for (const key of ['manualLectures', 'manualCoursework', 'manualAssessments']) {
      if (key in data && !Array.isArray(data[key])) throw new Error(`${key} must be an array.`);
    }
    for (const key of ['calendarSettings', 'canvasLecturePreferences', 'canvasCourseworkPreferences', 'canvasAssessmentPreferences']) {
      if (key in data && (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))) throw new Error(`${key} must be an object.`);
    }
    const saved = await canvasToDoApi.accountRequest<AcademyPreferences>(`${base}/data/preferences`, 'PUT', data);
    setPreferences(saved); setSettingsJson(JSON.stringify(saved, null, 2));
    setTheme(text(object(saved.calendarSettings).themeMode) || 'dark');
    setSemester(text(object(saved.calendarSettings).selectedSemester));
    return 'Account settings saved.';
  };
  const review = (request: PasswordChangeStatus, approve: boolean) => {
    void run(async () => {
      const result = await canvasToDoApi.accountRequest<{ message: string; request: PasswordChangeStatus }>(
        `${base}/password-request/review`, 'POST', { requestId: request.id, approve });
      setUser(current => current ? { ...current, passwordRequest: result.request } : current);
      return result.message;
    });
  };
  const loadLive = async () => {
    setBusy(true); setLiveMessage('Loading Canvas courses and the next 30 days…');
    const now = new Date(); const end = new Date(now.getTime() + 30 * 86400000);
    const results = await Promise.allSettled([
      canvasToDoApi.accountRequest<Record<string, unknown>>(`${base}/data/courses`),
      canvasToDoApi.accountRequest<Record<string, unknown>>(`${base}/data/calendar?startDate=${now.toISOString()}&endDate=${end.toISOString()}`),
    ]);
    if (results[0].status === 'fulfilled') setLiveCourses(array(results[0].value.courses));
    if (results[1].status === 'fulfilled') setLiveCalendar(array(results[1].value.items));
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : 'Canvas unavailable.'] : []);
    setLiveMessage(errors.join(' ') || 'Live Canvas preview loaded (next 30 days).');
    setBusy(false);
  };

  return <section className="grid min-w-0 gap-3 rounded-xl border bg-card p-3 sm:p-4">
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
      <Button className="h-8 gap-1.5 px-2 max-[520px]:size-11 max-[520px]:p-0" variant="outline" onClick={onClose} aria-label="Back to user management"><ArrowLeft className="size-4" /><span className="max-[520px]:hidden">Users</span></Button>
      <div className="min-w-0"><h2 className="truncate text-base font-semibold" title={user?.displayName}>{user?.displayName ?? 'Account details'}</h2><p className="truncate text-xs text-muted-foreground" title={user?.email}>{user?.email}</p></div>
      <Button className="size-8 max-[520px]:size-11" size="icon" variant="outline" aria-label="Refresh details" title="Refresh details" disabled={busy || loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}><RefreshCw className="size-4" /></Button>
    </div>
    <nav className="flex min-w-0 gap-1 overflow-x-auto border-b pb-2" aria-label="User detail sections">
      {(['profile', 'password', 'settings', 'canvas', 'preview'] as Tab[]).map(value => <Button className="h-8 shrink-0 gap-1.5 px-2.5 text-xs max-[520px]:h-11" key={value} variant={value === tab ? 'secondary' : 'ghost'} aria-current={value === tab ? 'page' : undefined} onClick={() => { setTab(value); setError(''); setMessage(''); }}>
        {value === 'preview' && <Eye className="size-3.5" />}{({ profile: 'Profile', password: 'Password', settings: 'Settings', canvas: 'Canvas', preview: 'Preview' })[value]}
        {((value === 'password' && user?.passwordRequest?.status === 'pending') || (value === 'canvas' && user?.manualModeRequest?.status === 'pending')) && <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-200">Pending</span>}
      </Button>)}
    </nav>
    {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive" role="alert">{error}</p>}
    {message && <p className="rounded-md border p-3 text-sm" role="status">{message}</p>}
    {loading ? <p role="status">Loading account details…</p> : !user ? <p>Account details are unavailable. Return to User Management and refresh.</p> : <>
      {tab === 'profile' && <form className="grid max-w-2xl gap-4" onSubmit={e => { e.preventDefault(); void run(async () => {
        const updated = await canvasToDoApi.updateAdminUser(userId, { displayName: name, email, phoneNumber: phone, status: user.status });
        setUser(current => ({ ...current!, ...updated, phoneNumber: phone })); return 'Profile saved.';
      }); }}>
        <label className="grid gap-1 text-sm">Name<Input required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Email<Input required type="email" maxLength={256} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Phone<Input type="tel" maxLength={50} value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <p className="text-sm text-muted-foreground">Role: {user.role} · Status: {user.status} · Two-step verification: {user.twoFactorEnabled ? 'On' : 'Off'}</p>
        <p className="text-xs text-muted-foreground">Verify the user's identity before changing their email. Changing it revokes existing sessions.</p>
        <Button type="submit" disabled={busy}>Save profile</Button>
      </form>}
      {tab === 'password' && <div className="grid max-w-2xl gap-5">
        <section className="grid gap-3 rounded-lg border p-4">
          <h3 className="font-bold">Password reset request</h3>
          {user.passwordRequest ? <>
            <p className="text-xs text-muted-foreground">{user.passwordRequest.source === 'email-verified-reset'
              ? 'Submitted through a verified email recovery link.'
              : 'Submitted from the public sign-in form or an older flow. Verify the requester’s identity before approving; an email address alone does not prove ownership.'}</p>
            <p className="text-sm">{user.passwordRequest.status} · requested {new Date(user.passwordRequest.requestedAt).toLocaleString()}</p>
            {user.passwordRequest.status === 'pending' && <div className="flex gap-2">
              <Button disabled={busy} onClick={() => review(user.passwordRequest!, true)}><ShieldCheck className="size-4" /> Approve password</Button>
              <Button variant="outline" disabled={busy} onClick={() => review(user.passwordRequest!, false)}>Reject</Button>
            </div>}
          </> : <p className="text-sm text-muted-foreground">No password reset request.</p>}
          <p className="text-xs text-muted-foreground">Approval applies the requested password and signs out existing sessions. Requested passwords cannot be viewed.</p>
        </section>
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (password !== confirmPassword) { setError('Passwords do not match.'); return; } void run(async () => {
          const result = await canvasToDoApi.accountRequest<{ message: string }>(`${base}/password`, 'POST', { newPassword: password, confirmPassword });
          setPassword(''); setConfirmPassword(''); setUser(current => ({ ...current!, passwordRequest: null })); return result.message;
        }); }}>
          <h3 className="font-bold">Set password as administrator</h3>
          <label className="grid gap-1 text-sm">New password<Input type="password" autoComplete="new-password" minLength={10} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">Confirm password<Input type="password" autoComplete="new-password" minLength={10} maxLength={256} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
          <p className="text-xs text-muted-foreground">At least 10 characters with uppercase, lowercase, a number, and four unique characters. This applies immediately and signs out existing sessions.</p>
          <Button type="submit" disabled={busy}>Set password</Button>
        </form>
      </div>}
      {tab === 'settings' && <div className="grid gap-5">
        {!preferences ? <p>Settings could not be loaded. Return and reopen this user.</p> : <>
          <form className="grid max-w-2xl gap-3" onSubmit={e => { e.preventDefault(); void run(() => saveSettings({ calendarSettings: { themeMode: theme, selectedSemester: semester } })); }}>
            <label className="grid gap-1 text-sm">Theme<select className="rounded-md border bg-background p-2" value={theme} onChange={e => setTheme(e.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label className="grid gap-1 text-sm">Selected semester<Input value={semester} onChange={e => setSemester(e.target.value)} /></label>
            <Button disabled={busy} type="submit">Save display settings</Button>
          </form>
          <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Advanced: profile, calendar, courses, coursework, and grade settings</summary>
            <p className="my-3 text-sm text-muted-foreground">Edit the saved settings below. Arrays replace the saved list; omitted sections are preserved. Refresh details before editing if the user is also making changes.</p>
            <label className="grid gap-2 text-sm">Saved account settings<textarea className="min-h-96 w-full rounded-md border bg-background p-3 font-mono text-xs" spellCheck={false} value={settingsJson} onChange={e => setSettingsJson(e.target.value)} /></label>
            <Button className="mt-3" disabled={busy} onClick={() => void run(() => saveSettings(JSON.parse(settingsJson)))}>Save advanced settings</Button>
          </details>
        </>}
      </div>}
      {tab === 'canvas' && user?.manualModeRequest && <section className="grid max-w-2xl gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <h3 className="text-sm font-semibold">Permanent manual mode: {user.manualModeRequest.status}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">Requested {new Date(user.manualModeRequest.requestedAt).toLocaleString()}. Approval permanently converts saved Canvas courses, removes the saved token and blocks reconnection.</p>
        {user.manualModeRequest.status === 'pending' && <div className="flex flex-wrap gap-2">
          {[true, false].map(approve => <Button className="h-8 text-xs max-[520px]:h-11" key={String(approve)} disabled={busy} variant={approve ? 'destructive' : 'outline'} onClick={() => {
            if (approve && !window.confirm(`Permanently enable manual mode for ${user.email}? This cannot be reversed.`)) return;
            void run(async () => {
              const result = await canvasToDoApi.accountRequest<ManualModeRequest>(`${base}/manual-mode/review`, 'POST', { requestId: user.manualModeRequest!.id, approve });
              setUser(current => current ? { ...current, manualModeRequest: result } : current);
              setRevision(value => value + 1);
              return approve ? 'Permanent manual mode approved.' : 'Manual mode request declined.';
            });
          }}>{approve ? 'Approve permanent manual mode' : 'Decline request'}</Button>)}
        </div>}
      </section>}
      {tab === 'canvas' && <div className="grid max-w-2xl gap-4">
        <p className="text-sm">Connection: {token?.status ?? 'unavailable'} · {token?.userName ?? 'No Canvas user'} · {token?.instanceUrl ?? 'No Canvas URL'}</p>
        <p className="text-xs text-muted-foreground">Saved tokens are encrypted and never displayed. You can validate and replace the token or disconnect this account.</p>
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void run(async () => {
          const result = await canvasToDoApi.accountRequest<CanvasTokenStatus>(`${base}/data/canvas-token`, 'PUT', {
            instanceUrl, accessToken, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          }); setToken(result); setAccessToken(''); return 'Canvas token validated and saved.';
        }); }}>
          <label className="grid gap-1 text-sm">Canvas URL<Input type="url" required value={instanceUrl} onChange={e => setInstanceUrl(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">Replacement API token<Input type="password" autoComplete="new-password" required maxLength={8192} value={accessToken} onChange={e => setAccessToken(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">Expires at (optional)<Input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></label>
          {token?.manualTokenEnabled === false && <p className="text-sm">Manual tokens are disabled in the deployment configuration.</p>}
          <Button disabled={busy || token?.manualTokenEnabled === false || token?.status === 'manual_mode'} type="submit">Validate and replace token</Button>
        </form>
        <Button variant="outline" disabled={busy || !token?.configured} onClick={() => {
          if (!window.confirm(`Disconnect Canvas for ${user.email}? The saved token will be removed.`)) return;
          void run(async () => { setToken(await canvasToDoApi.accountRequest<CanvasTokenStatus>(`${base}/data/canvas-token`, 'DELETE')); return 'Canvas disconnected.'; });
        }}>Disconnect Canvas</Button>
      </div>}
      {tab === 'preview' && <div className="grid gap-5">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><strong>Read-only preview: {user.displayName} ({user.email})</strong><p className="mt-1">Viewing this user's saved Academy data. You remain signed in as administrator.</p></div>
        <div className="grid gap-3 sm:grid-cols-3">{[['Account', user.status], ['Role', user.role], ['Canvas', token?.status ?? 'unavailable']].map(([label, value]) => <div className="rounded-lg border p-4" key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="font-bold">{value}</div></div>)}</div>
        {preferences ? <>
          <PreviewRecords title="Manual courses" rows={preferences.manualLectures} />
          <PreviewRecords title="Coursework and to-do items" rows={preferences.manualCoursework} />
          <PreviewRecords title="Assessments and grades" rows={preferences.manualAssessments} />
          <PreviewRecords title="Saved Canvas course settings and grades" rows={Object.entries(preferences.canvasLecturePreferences).map(([id, value]) => ({ id, ...object(value) }))} />
          <PreviewRecords title="Saved Canvas coursework" rows={Object.entries(preferences.canvasCourseworkPreferences).map(([id, value]) => ({ id, ...object(value) }))} />
          <PreviewRecords title="Saved Canvas assessments" rows={Object.entries(preferences.canvasAssessmentPreferences).map(([id, value]) => ({ id, ...object(value) }))} />
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">Profile and calendar settings</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(preferences.calendarSettings, null, 2)}</pre></details>
        </> : <p>Saved Academy data could not be loaded.</p>}
        <Button className="w-fit" disabled={busy || !token?.connected} onClick={() => void loadLive()}><RefreshCw className="size-4" /> Load live Canvas preview</Button>
        <p className="text-sm text-muted-foreground" role="status">{liveMessage}</p>
        <PreviewRecords title="Live Canvas courses" rows={liveCourses} />
        <PreviewRecords title="Upcoming Canvas calendar" rows={liveCalendar} />
      </div>}
    </>}
  </section>;
}
