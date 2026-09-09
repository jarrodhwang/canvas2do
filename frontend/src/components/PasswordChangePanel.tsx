import { useState, type FormEvent } from 'react';
import { canvasToDoApi } from '../api/canvasToDoApi';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function PasswordChangePanel({ hasPassword, onChanged }: {
  hasPassword: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const result = await canvasToDoApi.accountRequest<{ message: string }>(
        '/auth/change-password', 'POST', { currentPassword, newPassword: password, confirmPassword: confirmation });
      setMessage(result.message); setCurrentPassword(''); setPassword(''); setConfirmation('');
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to change your password.'); }
    finally { setBusy(false); }
  };
  return <section className="grid gap-3 rounded-lg border bg-muted/20 p-4">
    <h3 className="font-black">{hasPassword ? 'Change password' : 'Set a password'}</h3>
    <p className="text-sm text-muted-foreground">Your new password takes effect immediately. Administrator approval is not required.</p>
    <form className="grid gap-3" onSubmit={submit}>
      {hasPassword && <label className="grid gap-1 text-sm">Current password
        <Input autoComplete="current-password" type="password" maxLength={256} required disabled={busy} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
      </label>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">New password<Input autoComplete="new-password" type="password" minLength={10} maxLength={256} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Confirm new password<Input autoComplete="new-password" type="password" minLength={10} maxLength={256} required disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      </div>
      <p className="text-xs text-muted-foreground">At least 10 characters, uppercase, lowercase, a number, and four unique characters.</p>
      <Button className="w-fit" disabled={busy} type="submit">{busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}</Button>
    </form>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {message && <p className="text-sm" role="status">{message}</p>}
  </section>;
}
