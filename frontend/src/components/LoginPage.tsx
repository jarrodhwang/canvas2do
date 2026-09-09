import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CircleCheck,
  ExternalLink,
  GraduationCap,
  KeyRound,
  Loader2,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  UsersRound,
} from 'lucide-react';

import {
  canvasToDoApi,
  type AuthActionResponse,
  type AuthConfig,
} from '../api/canvasToDoApi';
import { appPath } from '../lib/appPath';
import type { AppTheme } from '../theme';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

interface LoginPageProps {
  academyLogoSrc?: string;
  authMessage?: string | null;
  isCheckingSession: boolean;
  onAcademyAuthenticated: () => Promise<void> | void;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
}

type AuthView = 'login' | 'signup' | 'forgot-password' | 'resend-confirmation';

type EmailAction =
  | { kind: 'confirm-email'; userId: string; code: string }
  | { kind: 'reset-password'; email: string; code: string };

type ConfirmationAction = Extract<EmailAction, { kind: 'confirm-email' }>;
type PasswordResetAction = Extract<EmailAction, { kind: 'reset-password' }>;

interface DevelopmentLink {
  href: string;
  label: string;
}

interface Feedback {
  message: string;
  tone: 'error' | 'success';
}

const emptyConfig: AuthConfig = {
  emailDeliveryConfigured: false,
  facebookConfigured: false,
  googleConfigured: false,
  passwordLoginConfigured: true,
  registrationApprovalRequired: true,
  twoFactorAvailable: true,
};

const maximumEmailLength = 256;
const passwordHelp = 'Use at least 10 characters with uppercase, lowercase, a number, and four unique characters.';

function isCompliantPassword(value: string) {
  return value.length >= 10 &&
    value.length <= 256 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    new Set(value).size >= 4;
}

function isValidConfirmationAction(action: EmailAction | null): action is ConfirmationAction {
  return action?.kind === 'confirm-email' &&
    Boolean(action.userId) && action.userId.length <= 100 &&
    Boolean(action.code) && action.code.length <= 16_384;
}

function isValidPasswordResetAction(action: EmailAction | null): action is PasswordResetAction {
  return action?.kind === 'reset-password' &&
    Boolean(action.email) && action.email.length <= maximumEmailLength &&
    Boolean(action.code) && action.code.length <= 16_384;
}

function readEmailAction(): EmailAction | null {
  const url = new URL(window.location.href);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  const isConfirmation = normalizedPath.endsWith('/confirm-email');
  const isPasswordReset = normalizedPath.endsWith('/reset-password');

  if (!isConfirmation && !isPasswordReset) {
    return null;
  }

  const fragmentParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  // Fragment parameters keep new bearer tokens out of HTTP access logs. Query parsing
  // remains temporarily supported for links issued before this change.
  const params = fragmentParams.has('code') ? fragmentParams : url.searchParams;
  const code = params.get('code') ?? '';
  const userId = params.get('userId') ?? '';
  const email = params.get('email') ?? '';

  return isConfirmation
    ? { code, kind: 'confirm-email', userId }
    : { code, email, kind: 'reset-password' };
}

function getDevelopmentLink(
  response: AuthActionResponse,
  action: 'confirm-email' | 'reset-password',
): DevelopmentLink | null {
  if (!response.developmentActionUrl || response.developmentActionUrl.length > 32_768) {
    return null;
  }

  try {
    const url = new URL(response.developmentActionUrl, window.location.origin);
    const normalizedPath = url.pathname.replace(/\/+$/, '');
    const isLoopback = url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]';

    if ((url.protocol !== 'https:' && url.protocol !== 'http:') ||
        (url.protocol === 'http:' && !isLoopback) ||
        url.username || url.password ||
        !normalizedPath.endsWith(`/${action}`)) {
      return null;
    }

    return {
      href: url.toString(),
      label: action === 'confirm-email'
        ? 'Open development confirmation link'
        : 'Open development password-reset link',
    };
  } catch {
    return null;
  }
}

export function LoginPage({
  authMessage,
  isCheckingSession,
  onAcademyAuthenticated,
  onThemeChange,
  theme,
}: LoginPageProps) {
  const [config, setConfig] = useState<AuthConfig>(emptyConfig);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [authView, setAuthView] = useState<AuthView>('login');
  const [emailAction, setEmailAction] = useState<EmailAction | null>(readEmailAction);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() =>
    new URLSearchParams(window.location.search).get('rememberMe') === 'true',
  );
  const [rememberMachine, setRememberMachine] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(() =>
    new URLSearchParams(window.location.search).get('requiresTwoFactor') === 'true',
  );
  const [isSubmitting, setIsSubmitting] = useState(() => isValidConfirmationAction(emailAction));
  const [feedback, setFeedback] = useState<Feedback | null>(() =>
    emailAction?.kind === 'confirm-email' && !isValidConfirmationAction(emailAction)
      ? {
          message: 'This confirmation link is incomplete or invalid. Request a new confirmation message.',
          tone: 'error',
        }
      : null,
  );
  const [developmentLink, setDevelopmentLink] = useState<DevelopmentLink | null>(null);
  const confirmationRequest = useRef<Promise<AuthActionResponse> | null>(null);
  const isDark = theme === 'dark';

  useLayoutEffect(() => {
    if (emailAction) {
      // Email action URLs contain bearer tokens. Remove the query/fragment before
      // paint and before the confirmation request starts.
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [emailAction]);

  useEffect(() => {
    let mounted = true;

    canvasToDoApi.getAuthConfig()
      .then((nextConfig) => {
        if (mounted) {
          setConfig(nextConfig);
        }
      })
      .catch(() => {
        // The secure fallback keeps password sign-in available while disabling
        // actions that require an email delivery service.
      })
      .finally(() => {
        if (mounted) {
          setIsConfigLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!requiresTwoFactor) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('requiresTwoFactor');
    url.searchParams.delete('rememberMe');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [requiresTwoFactor]);

  useEffect(() => {
    if (emailAction?.kind !== 'confirm-email') {
      return;
    }

    if (!isValidConfirmationAction(emailAction)) {
      return;
    }

    let mounted = true;
    const request = confirmationRequest.current ?? canvasToDoApi.confirmEmail({
      code: emailAction.code,
      userId: emailAction.userId,
    });
    confirmationRequest.current = request;

    request
      .then((result) => {
        if (mounted) {
          setFeedback({ message: result.message, tone: 'success' });
        }
      })
      .catch((confirmationError: unknown) => {
        if (mounted) {
          setFeedback({
            message: confirmationError instanceof Error
              ? confirmationError.message
              : 'Unable to confirm your email.',
            tone: 'error',
          });
        }
      })
      .finally(() => {
        if (mounted) {
          setIsSubmitting(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [emailAction]);

  const completeAuthentication = async () => {
    await onAcademyAuthenticated();
  };

  const showView = (view: AuthView) => {
    setAuthView(view);
    setFeedback(null);
    setDevelopmentLink(null);

    if (view === 'forgot-password' || view === 'resend-confirmation') {
      setRecoveryEmail(email);
    }
  };

  const returnToLogin = () => {
    window.history.replaceState(window.history.state, '', appPath('/'));
    confirmationRequest.current = null;
    setEmailAction(null);
    setResetPassword('');
    setResetConfirmPassword('');
    showView('login');
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setDevelopmentLink(null);
    setIsSubmitting(true);

    try {
      const result = await canvasToDoApi.login({ email, password, rememberMe });

      if (result.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setTwoFactorCode('');
        return;
      }

      await completeAuthentication();
    } catch (loginError) {
      setFeedback({
        message: loginError instanceof Error ? loginError.message : 'Unable to sign in.',
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setDevelopmentLink(null);

    if (signupPassword !== signupConfirmPassword) {
      setFeedback({ message: 'The passwords do not match.', tone: 'error' });
      return;
    }

    if (!isCompliantPassword(signupPassword)) {
      setFeedback({ message: passwordHelp, tone: 'error' });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await canvasToDoApi.signup({
        displayName,
        email: signupEmail,
        password: signupPassword,
      });
      setEmail(signupEmail.trim());
      setRecoveryEmail(signupEmail.trim());
      setSignupPassword('');
      setSignupConfirmPassword('');
      setAuthView('login');
      setFeedback({
        message: result.message,
        tone: 'success',
      });
      setDevelopmentLink(getDevelopmentLink(result, 'confirm-email'));
    } catch (signupError) {
      setFeedback({
        message: signupError instanceof Error ? signupError.message : 'Unable to create your account.',
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setDevelopmentLink(null);

    if (!config.emailDeliveryConfigured) {
      setFeedback({
        message: 'Email delivery is not configured. Contact the site operator for account help.',
        tone: 'error',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = authView === 'forgot-password'
        ? await canvasToDoApi.forgotPassword(recoveryEmail)
        : await canvasToDoApi.resendConfirmation(recoveryEmail);
      const action = authView === 'forgot-password' ? 'reset-password' : 'confirm-email';
      setFeedback({ message: result.message, tone: 'success' });
      setDevelopmentLink(getDevelopmentLink(result, action));
    } catch (requestError) {
      setFeedback({
        message: requestError instanceof Error ? requestError.message : 'Unable to send account instructions.',
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (!isValidPasswordResetAction(emailAction)) {
      setFeedback({
        message: 'This password-reset link is incomplete or invalid. Request a new one.',
        tone: 'error',
      });
      return;
    }

    if (resetPassword !== resetConfirmPassword) {
      setFeedback({ message: 'The passwords do not match.', tone: 'error' });
      return;
    }

    if (!isCompliantPassword(resetPassword)) {
      setFeedback({ message: passwordHelp, tone: 'error' });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await canvasToDoApi.resetPassword({
        code: emailAction.code,
        email: emailAction.email,
        newPassword: resetPassword,
      });
      setEmail(emailAction.email);
      setResetPassword('');
      setResetConfirmPassword('');
      setFeedback({ message: result.message, tone: 'success' });
    } catch (resetError) {
      setFeedback({
        message: resetError instanceof Error ? resetError.message : 'Unable to reset your password.',
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      if (useRecoveryCode) {
        await canvasToDoApi.loginWithRecoveryCode(twoFactorCode);
      } else {
        await canvasToDoApi.loginWithTwoFactor({
          code: twoFactorCode,
          rememberMachine,
          rememberMe,
        });
      }

      await completeAuthentication();
    } catch (twoFactorError) {
      setFeedback({
        message: twoFactorError instanceof Error
          ? twoFactorError.message
          : 'The verification code was not accepted.',
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const socialLogin = (provider: 'google' | 'facebook') => {
    window.location.assign(canvasToDoApi.getExternalLoginUrl(provider, appPath('/'), rememberMe));
  };

  const renderEmailAction = () => {
    if (emailAction?.kind === 'confirm-email') {
      return (
        <section aria-busy={isSubmitting} aria-labelledby="email-action-title" className="grid gap-4">
          <div aria-live="polite" className="flex items-start gap-3 rounded-lg border bg-primary/5 p-4" role="status">
            {isSubmitting ? (
              <Loader2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
            ) : (
              <Mail aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
            )}
            <div>
              <h2 className="text-sm font-black" id="email-action-title">Confirming your email</h2>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-muted-foreground">
                {isSubmitting ? 'Please wait while Canvas To Do verifies this link.' : 'Email verification is complete or needs your attention below.'}
              </p>
            </div>
          </div>
          {!isSubmitting ? (
            <Button className="h-11 font-black" onClick={returnToLogin} type="button">
              Continue to sign in
            </Button>
          ) : null}
        </section>
      );
    }

    const resetLinkIsValid = isValidPasswordResetAction(emailAction);
    const resetSucceeded = feedback?.tone === 'success';

    if (!resetLinkIsValid || resetSucceeded) {
      return (
        <section aria-labelledby="email-action-title" className="grid gap-4">
          <div className="flex items-start gap-3 rounded-lg border bg-primary/5 p-4">
            {resetSucceeded ? (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            ) : (
              <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
            )}
            <div>
              <h2 className="text-sm font-black" id="email-action-title">
                {resetSucceeded ? 'Password reset complete' : 'Password-reset link invalid'}
              </h2>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-muted-foreground">
                {resetSucceeded
                  ? 'You can now sign in with your new password.'
                  : 'Request a fresh password-reset message to continue.'}
              </p>
            </div>
          </div>
          <Button className="h-11 font-black" onClick={returnToLogin} type="button">
            {resetSucceeded ? 'Continue to sign in' : 'Return to sign in'}
          </Button>
        </section>
      );
    }

    return (
      <form className="grid gap-4" onSubmit={handlePasswordReset}>
        <div className="flex items-start gap-3 rounded-lg border bg-primary/5 p-4">
          <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 className="text-sm font-black" id="email-action-title">Choose a new password</h2>
            <p className="mt-1 text-xs font-semibold leading-relaxed text-muted-foreground">
              Enter and confirm the new password for your Canvas To Do account.
            </p>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reset-password">New password</Label>
          <Input
            aria-describedby="reset-password-requirements"
            autoComplete="new-password"
            autoFocus
            id="reset-password"
            maxLength={256}
            minLength={10}
            onChange={(event) => setResetPassword(event.target.value)}
            required
            type="password"
            value={resetPassword}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reset-confirm-password">Confirm new password</Label>
          <Input
            aria-describedby="reset-password-requirements"
            autoComplete="new-password"
            id="reset-confirm-password"
            maxLength={256}
            minLength={10}
            onChange={(event) => setResetConfirmPassword(event.target.value)}
            required
            type="password"
            value={resetConfirmPassword}
          />
        </div>
        <p className="text-xs font-semibold leading-5 text-muted-foreground" id="reset-password-requirements">{passwordHelp}</p>
        <Button className="h-11 font-black" disabled={isSubmitting} type="submit">
          {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Reset password
        </Button>
      </form>
    );
  };

  const renderTwoFactor = () => (
    <form className="grid gap-4" onSubmit={handleTwoFactor}>
      <div className="flex items-start gap-3 rounded-lg border bg-primary/5 p-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-sm font-black">Two-step verification</h2>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {useRecoveryCode ? 'Enter one of your saved recovery codes.' : 'Enter the six-digit code from your authenticator app.'}
          </p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="two-factor-code">{useRecoveryCode ? 'Recovery code' : 'Verification code'}</Label>
        <Input
          autoComplete={useRecoveryCode ? 'off' : 'one-time-code'}
          autoFocus
          id="two-factor-code"
          inputMode={useRecoveryCode ? 'text' : 'numeric'}
          onChange={(event) => setTwoFactorCode(event.target.value)}
          required
          value={twoFactorCode}
        />
      </div>
      {!useRecoveryCode ? (
        <label className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm font-semibold">
          <span>Trust this device</span>
          <Switch checked={rememberMachine} onCheckedChange={setRememberMachine} />
        </label>
      ) : null}
      <Button className="h-11 font-black" disabled={isSubmitting} type="submit">
        {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        Verify and sign in
      </Button>
      <div className="flex items-center justify-between gap-3">
        <Button
          onClick={() => {
            setRequiresTwoFactor(false);
            setFeedback(null);
          }}
          type="button"
          variant="ghost"
        >
          Back
        </Button>
        <Button
          onClick={() => {
            setUseRecoveryCode((current) => !current);
            setTwoFactorCode('');
          }}
          type="button"
          variant="link"
        >
          {useRecoveryCode ? 'Use authenticator code' : 'Use a recovery code'}
        </Button>
      </div>
    </form>
  );

  const renderEmailRequest = () => {
    const isPasswordRequest = authView === 'forgot-password';

    return (
      <form className="grid gap-4" onSubmit={handleEmailRequest}>
        <Button className="w-fit px-0" onClick={() => showView('login')} type="button" variant="link">
          <ArrowLeft className="size-4" /> Back to sign in
        </Button>
        <div>
          <h2 className="text-lg font-black">
            {isPasswordRequest ? 'Reset your password' : 'Confirm your email'}
          </h2>
          <p className="mt-1 text-sm font-semibold leading-relaxed text-muted-foreground">
            {isPasswordRequest
              ? 'If an eligible password account uses this address, we will send reset instructions.'
              : 'If an unconfirmed account uses this address, we will send a fresh confirmation link.'}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="recovery-email">Email</Label>
          <Input
            autoComplete="email"
            autoFocus
            id="recovery-email"
            maxLength={maximumEmailLength}
            onChange={(event) => setRecoveryEmail(event.target.value)}
            required
            type="email"
            value={recoveryEmail}
          />
        </div>
        {!isConfigLoading && !config.emailDeliveryConfigured ? (
          <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200" role="status">
            Email delivery is not configured. Contact the site operator for account help.
          </div>
        ) : null}
        <Button
          className="h-11 font-black"
          disabled={isSubmitting || isConfigLoading || !config.emailDeliveryConfigured}
          type="submit"
        >
          {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          {isPasswordRequest ? 'Send reset instructions' : 'Resend confirmation'}
        </Button>
      </form>
    );
  };

  const renderPasswordAuth = () => (
    <Tabs
      onValueChange={(value) => showView(value as 'login' | 'signup')}
      value={authView === 'signup' ? 'signup' : 'login'}
    >
      <TabsList className="grid h-11 w-full grid-cols-2">
        <TabsTrigger value="login">Sign in</TabsTrigger>
        <TabsTrigger value="signup">Create account</TabsTrigger>
      </TabsList>
      <TabsContent className="mt-4" value="login">
        <form className="grid gap-3" onSubmit={handleLogin}>
          <div className="grid gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              autoComplete="email"
              id="login-email"
              maxLength={maximumEmailLength}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="login-password">Password</Label>
              <Button
                className="h-auto p-0 text-xs"
                onClick={() => showView('forgot-password')}
                type="button"
                variant="link"
              >
                Forgot password?
              </Button>
            </div>
            <Input
              autoComplete="current-password"
              id="login-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
          <Button className="h-11 font-black" disabled={isSubmitting} type="submit">
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Sign in
          </Button>
          <Button
            disabled={!config.emailDeliveryConfigured}
            onClick={() => showView('resend-confirmation')}
            type="button"
            variant="ghost"
          >
            Resend email confirmation
          </Button>
        </form>
      </TabsContent>
      <TabsContent className="mt-4" value="signup">
        <form className="grid gap-3" onSubmit={handleSignup}>
          <div className="grid gap-1.5">
            <Label htmlFor="signup-name">Name</Label>
            <Input
              autoComplete="name"
              id="signup-name"
              maxLength={160}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              autoComplete="email"
              id="signup-email"
              maxLength={maximumEmailLength}
              onChange={(event) => setSignupEmail(event.target.value)}
              required
              type="email"
              value={signupEmail}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                aria-describedby="signup-password-requirements"
                autoComplete="new-password"
                id="signup-password"
                maxLength={256}
                minLength={10}
                onChange={(event) => setSignupPassword(event.target.value)}
                required
                type="password"
                value={signupPassword}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="signup-confirm-password">Confirm</Label>
              <Input
                aria-describedby="signup-password-requirements"
                autoComplete="new-password"
                id="signup-confirm-password"
                maxLength={256}
                minLength={10}
                onChange={(event) => setSignupConfirmPassword(event.target.value)}
                required
                type="password"
                value={signupConfirmPassword}
              />
            </div>
          </div>
          <p className="text-xs font-semibold leading-5 text-muted-foreground" id="signup-password-requirements">{passwordHelp}</p>
          {!isConfigLoading && config.registrationApprovalRequired ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200" role="status">
              New accounts require administrator approval before they can sign in.
            </div>
          ) : null}
          <Button
            className="h-11 font-black"
            disabled={isSubmitting || isConfigLoading}
            type="submit"
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <GraduationCap className="size-4" />}
            Create account
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  );

  const showSocialLogin = !emailAction && !isCheckingSession && !requiresTwoFactor &&
    (authView === 'login' || authView === 'signup') &&
    (config.googleConfigured || config.facebookConfigured);
  const visibleFeedback: Feedback | null = feedback ?? (
    !emailAction && authMessage ? { message: authMessage, tone: 'error' } : null
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-muted/35 p-4 sm:p-6">
      <Card className="w-full max-w-[520px] overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/5">
        <CardHeader className="gap-5 border-b bg-muted/20 p-6 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                <GraduationCap aria-hidden="true" className="size-6" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xl font-black tracking-tight">Canvas To Do</div>
                <div className="truncate text-xs font-semibold text-muted-foreground">Your academic calendar, in one place</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                aria-label={isDark ? 'Use light theme' : 'Use dark theme'}
                onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
                size="icon"
                type="button"
                variant="outline"
              >
                {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
              </Button>
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-black">Welcome</CardTitle>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Sign in to see your private Canvas calendar and study plan.
            </p>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 p-6 sm:p-7">
          {emailAction ? renderEmailAction() : isCheckingSession ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/25 p-4 text-sm font-bold text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" /> Checking your session…
            </div>
          ) : requiresTwoFactor ? renderTwoFactor() : (
            authView === 'forgot-password' || authView === 'resend-confirmation'
              ? renderEmailRequest()
              : renderPasswordAuth()
          )}

          {!emailAction && !isCheckingSession && !requiresTwoFactor &&
          (authView === 'login' || showSocialLogin) ? (
            <label className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm font-semibold">
              <span>Keep me signed in on this device</span>
              <Switch checked={rememberMe} onCheckedChange={setRememberMe} />
            </label>
          ) : null}

          {showSocialLogin ? (
            <>
              <div className="flex items-center gap-3 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> Or continue with <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {config.googleConfigured ? (
                  <Button onClick={() => socialLogin('google')} type="button" variant="outline">
                    <span className="text-base font-black text-blue-600">G</span> Google
                  </Button>
                ) : null}
                {config.facebookConfigured ? (
                  <Button onClick={() => socialLogin('facebook')} type="button" variant="outline">
                    <UsersRound className="size-4 text-blue-600" /> Facebook
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}

          {visibleFeedback ? (
            <div
              aria-live="polite"
              className={visibleFeedback.tone === 'error'
                ? 'rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive'
                : 'rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-200'}
              role={visibleFeedback.tone === 'error' ? 'alert' : 'status'}
            >
              {visibleFeedback.message}
            </div>
          ) : null}

          {developmentLink ? (
            <a
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm font-black text-primary hover:bg-muted"
              href={developmentLink.href}
              referrerPolicy="no-referrer"
              rel="noreferrer"
            >
              {developmentLink.label} <ExternalLink className="size-4" />
            </a>
          ) : null}

          <p className="text-center text-xs font-semibold leading-relaxed text-muted-foreground">
            Canvas is connected separately after sign-in. Canvas To Do never asks for your SFU password.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
