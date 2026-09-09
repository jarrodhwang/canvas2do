import { useEffect, useState, type FormEvent } from 'react';
import { canvasToDoApi, type PasswordChangeStatus } from '../api/canvasToDoApi';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function PasswordChangePanel() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [request, setRequest] = useState<PasswordChangeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async () => {
    try {
      const data = await canvasToDoApi.accountRequest<{ request: PasswordChangeStatus | null }>('/auth/password-request');
      setRequest(data.request); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load password request.'); }
  };
  useEffect(() => {
    let active = true;
    void canvasToDoApi.accountRequest<{ request: PasswordChangeStatus | null }>('/auth/password-request')
      .then(data => { if (active) setRequest(data.request); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load password request.'); });
    return () => { active = false; };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const result = await canvasToDoApi.accountRequest<{ message: string; request: PasswordChangeStatus }>(
        '/auth/password-request', 'POST', { newPassword: password, confirmPassword: confirmation });
      setRequest(result.request); setMessage(result.message); setPassword(''); setConfirmation('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to request password change.'); }
    finally { setBusy(false); }
  };
  return <section className="grid gap-3 rounded-lg border bg-muted/20 p-4">
    <h3 className="font-black">Request a password change</h3>
    <p className="text-sm text-muted-foreground">Choose a new password and wait for administrator approval. Your current password stays valid until approval; then you will need to sign in again.</p>
    {request && <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm" role="status">
      <span>Last request: <strong>{request.status}</strong>{request.status === 'pending' ? ` · expires ${new Date(request.expiresAt).toLocaleString()}` : ''}</span>
      <Button type="button" variant="outline" onClick={() => void refresh()}>Refresh status</Button>
    </div>}
    <form className="grid gap-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">New password<Input autoComplete="new-password" type="password" minLength={10} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Confirm password<Input autoComplete="new-password" type="password" minLength={10} maxLength={256} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      </div>
      <p className="text-xs text-muted-foreground">At least 10 characters, uppercase, lowercase, a number, and four unique characters. Submitting again replaces your pending request.</p>
      <Button className="w-fit" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Request approval'}</Button>
    </form>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {message && <p className="text-sm" role="status">{message}</p>}
  </section>;
}
