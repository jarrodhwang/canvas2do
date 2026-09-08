import { Copy, KeyRound, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import {
  canvasToDoApi,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from '../api/canvasToDoApi';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function AccountSecurityPanel({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadStatus = async () => {
    setStatus(await canvasToDoApi.getTwoFactorStatus());
  };

  useEffect(() => {
    let mounted = true;
    canvasToDoApi.getTwoFactorStatus()
      .then((nextStatus) => {
        if (mounted) setStatus(nextStatus);
      })
      .catch((loadError: unknown) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Unable to load security settings.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const beginSetup = async () => {
    setIsBusy(true);
    setError('');
    setMessage('');
    try {
      setSetup(await canvasToDoApi.beginTwoFactorSetup());
      setCode('');
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'Unable to start setup.');
    } finally {
      setIsBusy(false);
    }
  };

  const confirmSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setError('');
    try {
      const result = await canvasToDoApi.confirmTwoFactor(code);
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode('');
      setMessage('Two-step verification is now enabled. Save the recovery codes below.');
      await loadStatus();
      await onChanged?.();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'The verification code was not accepted.');
    } finally {
      setIsBusy(false);
    }
  };

  const disable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setError('');
    try {
      await canvasToDoApi.disableTwoFactor(code);
      setCode('');
      setRecoveryCodes([]);
      setMessage('Two-step verification was disabled.');
      await loadStatus();
      await onChanged?.();
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : 'Unable to disable two-step verification.');
    } finally {
      setIsBusy(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage('Copied to clipboard.');
  };

  return (
    <details className="group rounded-lg border bg-muted/20 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
            <ShieldCheck className="size-4" />
          </span>
          <span>Account security</span>
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          {status?.enabled ? 'Two-step verification on' : 'Two-step verification off'}
        </span>
      </summary>
      <div className="mt-4 grid gap-4">
        <p className="text-sm font-semibold leading-relaxed text-muted-foreground">
          Protect your account with time-based codes from an authenticator app. Administrators should always enable this.
        </p>
        {error || message ? (
          <div className={error
            ? 'rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive'
            : 'rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-200'}>
            {error || message}
          </div>
        ) : null}

        {!status?.enabled && !setup ? (
          <Button className="w-fit" disabled={isBusy || !status} onClick={() => void beginSetup()} type="button">
            {isBusy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Set up authenticator
          </Button>
        ) : null}

        {setup ? (
          <form className="grid gap-3 rounded-lg border bg-card p-3" onSubmit={confirmSetup}>
            <div>
              <h4 className="text-sm font-black">Add Canvas To Do to your authenticator</h4>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Enter this setup key in 1Password, Google Authenticator, Microsoft Authenticator, or another TOTP app.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
              <code className="min-w-0 flex-1 break-all text-sm font-black">{setup.sharedKey}</code>
              <Button aria-label="Copy setup key" onClick={() => void copy(setup.sharedKey)} size="icon" type="button" variant="outline">
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-2fa-code">Six-digit code</Label>
              <Input
                autoComplete="one-time-code"
                id="confirm-2fa-code"
                inputMode="numeric"
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setSetup(null); setCode(''); }} type="button" variant="outline">Cancel</Button>
              <Button disabled={isBusy} type="submit">{isBusy ? <Loader2 className="size-4 animate-spin" /> : null}Verify and enable</Button>
            </div>
          </form>
        ) : null}

        {status?.enabled ? (
          <form className="grid gap-3 rounded-lg border bg-card p-3" onSubmit={disable}>
            <div className="grid gap-1.5">
              <Label htmlFor="disable-2fa-code">Authenticator code to disable</Label>
              <Input
                autoComplete="one-time-code"
                id="disable-2fa-code"
                inputMode="numeric"
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </div>
            <Button className="w-fit" disabled={isBusy} type="submit" variant="destructive">
              {isBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
              Disable two-step verification
            </Button>
          </form>
        ) : null}

        {recoveryCodes.length > 0 ? (
          <div className="grid gap-3 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3">
            <div>
              <h4 className="text-sm font-black">Save these one-time recovery codes</h4>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">They will not be shown again.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm font-bold">
              {recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
            </div>
            <Button className="w-fit" onClick={() => void copy(recoveryCodes.join('\n'))} type="button" variant="outline">
              <Copy className="size-4" /> Copy all
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
