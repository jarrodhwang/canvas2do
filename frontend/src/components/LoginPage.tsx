import { type ChangeEvent, type FormEvent, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  GraduationCap,
  ImagePlus,
  KeyRound,
  Languages,
  Loader2,
  Moon,
  Search,
  Sun,
  UserRound,
} from 'lucide-react';
import { workspaceApi } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { languageOptions, type Language } from '../i18n';
import { appPath } from '../lib/appPath';
import type { AppTheme } from '../theme';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
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

const profileImageMaxBytes = 256 * 1024;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}

export function LoginPage({
  academyLogoSrc,
  authMessage,
  isCheckingSession,
  onAcademyAuthenticated,
  onThemeChange,
  theme,
}: LoginPageProps) {
  const { dictionary, language, setLanguage } = useLanguage();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [academyError, setAcademyError] = useState<string | null>(null);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [isAcademySigningIn, setIsAcademySigningIn] = useState(false);
  const [isAcademySigningUp, setIsAcademySigningUp] = useState(false);
  const [isCheckingId, setIsCheckingId] = useState(false);
  const [academyLoginId, setAcademyLoginId] = useState('');
  const [academyPassword, setAcademyPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupId, setSignupId] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupCanvasInstanceUrl, setSignupCanvasInstanceUrl] = useState('https://canvas.sfu.ca');
  const [signupCanvasAccessToken, setSignupCanvasAccessToken] = useState('');
  const [signupProfileImage, setSignupProfileImage] = useState<string | undefined>();
  const [idAvailability, setIdAvailability] = useState<{ id: string; available: boolean } | null>(null);
  const isDark = theme === 'dark';
  const visibleError = academyError ?? loginError ?? authMessage;
  const isAcademyBranded = academyLogoSrc !== undefined;
  const loginLogoSrc = isAcademyBranded
    ? academyLogoSrc && academyLogoSrc !== 'none'
      ? academyLogoSrc
      : appPath('/brand/SFU_block_colour_rgb.png')
    : appPath('/brand/INCOS%20New%20Logo_Crop.png');
  const loginLogoAlt = isAcademyBranded ? 'Academy' : 'INCOS';

  const handleGoogleLogin = async () => {
    setLoginError(null);
    setAcademyError(null);
    setIsStartingLogin(true);

    try {
      const config = await workspaceApi.getAuthConfig();

      if (!config.googleConfigured) {
        setLoginError(dictionary.googleOAuthNotConfigured);
        setIsStartingLogin(false);
        return;
      }

      window.location.assign(workspaceApi.getGoogleLoginUrl(appPath('/'), { forceConsent: true, forceLogin: true }));
    } catch {
      setLoginError(dictionary.googleOAuthNotConfigured);
      setIsStartingLogin(false);
    }
  };

  const handleAcademyLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAcademyError(null);
    setSignupNotice(null);
    setIsAcademySigningIn(true);

    try {
      await workspaceApi.loginWithAcademyCredentials({
        loginId: academyLoginId,
        password: academyPassword,
      });
      await onAcademyAuthenticated();
    } catch (error) {
      setAcademyError(error instanceof Error ? error.message : dictionary.academyLoginGenericError);
    } finally {
      setIsAcademySigningIn(false);
    }
  };

  const handleCheckSignupId = async () => {
    setAcademyError(null);
    setSignupNotice(null);
    setIsCheckingId(true);

    try {
      const result = await workspaceApi.checkAcademyLoginId(signupId);
      setIdAvailability({ id: result.loginId, available: result.available });
    } catch (error) {
      setAcademyError(error instanceof Error ? error.message : dictionary.academyIdCheckError);
    } finally {
      setIsCheckingId(false);
    }
  };

  const handleSignupProfileImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setAcademyError(null);

    if (!file) {
      setSignupProfileImage(undefined);
      return;
    }

    if (!file.type.startsWith('image/') || file.size > profileImageMaxBytes) {
      event.target.value = '';
      setSignupProfileImage(undefined);
      setAcademyError(dictionary.academyProfileImageInvalid);
      return;
    }

    try {
      setSignupProfileImage(await readFileAsDataUrl(file));
    } catch (error) {
      setAcademyError(error instanceof Error ? error.message : dictionary.academyProfileImageInvalid);
    }
  };

  const handleAcademySignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAcademyError(null);
    setSignupNotice(null);
    setIsAcademySigningUp(true);

    try {
      const result = await workspaceApi.signupAcademyAccount({
        name: signupName,
        loginId: signupId,
        password: signupPassword,
        confirmPassword: signupConfirmPassword,
        profileImageDataUrl: signupProfileImage,
        canvasInstanceUrl: signupCanvasInstanceUrl,
        canvasAccessToken: signupCanvasAccessToken || undefined,
      });

      setSignupNotice(result.canvasTokenConfigured || !signupCanvasAccessToken
        ? dictionary.academySignupCreated
        : dictionary.academySignupCreatedCanvasTokenMissing);
      await workspaceApi.loginWithAcademyCredentials({
        loginId: signupId,
        password: signupPassword,
      });
      await onAcademyAuthenticated();
    } catch (error) {
      setAcademyError(error instanceof Error ? error.message : dictionary.academySignupGenericError);
    } finally {
      setIsAcademySigningUp(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-[680px] rounded-xl bg-card shadow-none">
        <CardHeader className="gap-6 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <img
              alt={loginLogoAlt}
              className="h-16 w-auto max-w-[280px] object-contain sm:h-[74px] sm:max-w-[340px]"
              src={loginLogoSrc}
            />
            <div className="flex shrink-0 items-center gap-2">
              <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
                <SelectTrigger
                  aria-label={dictionary.language}
                  className="h-9 w-[78px] rounded-lg bg-muted/60 px-2 text-xs font-black"
                >
                  <Languages aria-hidden="true" className="mr-1 size-4 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.shortLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="hidden items-center gap-2 rounded-lg border bg-muted/60 px-2 py-2 sm:flex">
                <Sun aria-hidden="true" className="text-muted-foreground" size={14} />
                <Switch
                  aria-label={dictionary.darkMode}
                  checked={isDark}
                  onCheckedChange={(checked) => onThemeChange(checked ? 'dark' : 'light')}
                />
                <Moon aria-hidden="true" className={isDark ? 'text-primary' : 'text-muted-foreground'} size={14} />
                <Label className="sr-only">{dictionary.darkMode}</Label>
              </div>
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-black leading-tight">
              {dictionary.loginTitle}
            </CardTitle>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {dictionary.loginCombinedSubtitle}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6 sm:px-7 sm:pb-7">
          <Tabs defaultValue="workspace">
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-lg border bg-muted p-1">
              <TabsTrigger className="gap-2 rounded-md text-xs font-black" value="workspace">
                <KeyRound aria-hidden="true" className="size-4" />
                {dictionary.loginWorkspaceTab}
              </TabsTrigger>
              <TabsTrigger className="gap-2 rounded-md text-xs font-black" value="academy">
                <GraduationCap aria-hidden="true" className="size-4" />
                {dictionary.loginAcademyTab}
              </TabsTrigger>
            </TabsList>

            <TabsContent className="mt-4 space-y-3" value="workspace">
              <Button
                disabled={isStartingLogin}
                onClick={handleGoogleLogin}
                className="h-12 w-full justify-center gap-2 rounded-lg bg-primary text-sm font-black text-primary-foreground hover:bg-primary/90"
                type="button"
              >
                <span className="grid size-5 place-items-center rounded bg-primary-foreground text-xs font-black text-primary">
                  {isStartingLogin ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : 'G'}
                </span>
                <span>
                  {isStartingLogin
                    ? dictionary.checkingGoogleConfig
                    : dictionary.continueWithWorkspaceGoogle}
                </span>
              </Button>
              <div className="rounded-lg border bg-muted/35 p-3 text-xs font-semibold text-muted-foreground">
                {dictionary.loginProviderNote}
              </div>
            </TabsContent>

            <TabsContent className="mt-4 space-y-4" value="academy">
              <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                <form
                  autoComplete="on"
                  className="grid gap-3 rounded-lg border bg-muted/20 p-3"
                  onSubmit={handleAcademyLogin}
                >
                  <div>
                    <h2 className="text-sm font-black">{dictionary.academySignInTitle}</h2>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      {dictionary.academySignInNote}
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs font-black" htmlFor="academy-login-id">{dictionary.academyLoginId}</Label>
                    <Input
                      autoComplete="username"
                      id="academy-login-id"
                      name="username"
                      onChange={(event) => setAcademyLoginId(event.target.value)}
                      required
                      value={academyLoginId}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs font-black" htmlFor="academy-login-password">{dictionary.academyPassword}</Label>
                    <Input
                      autoComplete="current-password"
                      id="academy-login-password"
                      name="current-password"
                      onChange={(event) => setAcademyPassword(event.target.value)}
                      required
                      type="password"
                      value={academyPassword}
                    />
                  </div>
                  <Button className="h-10 font-black" disabled={isAcademySigningIn} type="submit">
                    {isAcademySigningIn ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    {dictionary.academySignIn}
                  </Button>
                </form>

                <form
                  autoComplete="on"
                  className="grid gap-3 rounded-lg border bg-muted/20 p-3"
                  onSubmit={handleAcademySignup}
                >
                  <div>
                    <h2 className="text-sm font-black">{dictionary.academySignUpTitle}</h2>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      {dictionary.academySignUpNote}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs font-black" htmlFor="academy-signup-name">{dictionary.academyName}</Label>
                      <Input
                        autoComplete="name"
                        id="academy-signup-name"
                        maxLength={160}
                        name="name"
                        onChange={(event) => setSignupName(event.target.value)}
                        required
                        value={signupName}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs font-black" htmlFor="academy-signup-id">{dictionary.academyLoginId}</Label>
                      <div className="flex gap-2">
                        <Input
                          autoComplete="username"
                          id="academy-signup-id"
                          maxLength={64}
                          name="username"
                          onChange={(event) => {
                            setSignupId(event.target.value);
                            setIdAvailability(null);
                          }}
                          required
                          value={signupId}
                        />
                        <Button
                          aria-label={dictionary.academyCheckId}
                          className="shrink-0 px-3"
                          disabled={isCheckingId || signupId.trim().length < 3}
                          onClick={handleCheckSignupId}
                          type="button"
                          variant="outline"
                        >
                          {isCheckingId ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                        </Button>
                      </div>
                      {idAvailability ? (
                        <span className={idAvailability.available
                          ? 'inline-flex items-center gap-1 text-xs font-black text-emerald-600'
                          : 'inline-flex items-center gap-1 text-xs font-black text-destructive'}
                        >
                          {idAvailability.available ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
                          {idAvailability.available ? dictionary.academyIdAvailable : dictionary.academyIdUnavailable}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs font-black" htmlFor="academy-signup-password">{dictionary.academyPassword}</Label>
                      <Input
                        autoComplete="new-password"
                        id="academy-signup-password"
                        minLength={8}
                        name="new-password"
                        onChange={(event) => setSignupPassword(event.target.value)}
                        required
                        type="password"
                        value={signupPassword}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs font-black" htmlFor="academy-signup-confirm">{dictionary.academyConfirmPassword}</Label>
                      <Input
                        autoComplete="new-password"
                        id="academy-signup-confirm"
                        minLength={8}
                        name="confirm-password"
                        onChange={(event) => setSignupConfirmPassword(event.target.value)}
                        required
                        type="password"
                        value={signupConfirmPassword}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="grid gap-1.5">
                      <Label className="text-xs font-black" htmlFor="academy-signup-image">{dictionary.academyProfileImage}</Label>
                      <Input
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        id="academy-signup-image"
                        onChange={handleSignupProfileImageChange}
                        type="file"
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="grid size-12 place-items-center overflow-hidden rounded-lg border bg-background">
                        {signupProfileImage ? (
                          <img alt="" className="size-full object-cover" src={signupProfileImage} />
                        ) : (
                          <ImagePlus aria-hidden="true" className="size-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs font-black" htmlFor="academy-signup-canvas-url">{dictionary.academyCanvasUrl}</Label>
                      <Input
                        id="academy-signup-canvas-url"
                        onChange={(event) => setSignupCanvasInstanceUrl(event.target.value)}
                        value={signupCanvasInstanceUrl}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs font-black" htmlFor="academy-signup-canvas-token">{dictionary.academyCanvasApiToken}</Label>
                      <Input
                        autoComplete="off"
                        id="academy-signup-canvas-token"
                        onChange={(event) => setSignupCanvasAccessToken(event.target.value)}
                        placeholder={dictionary.academyCanvasTokenOptional}
                        type="password"
                        value={signupCanvasAccessToken}
                      />
                    </div>
                  </div>
                  <Button className="h-10 font-black" disabled={isAcademySigningUp} type="submit">
                    {isAcademySigningUp ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <UserRound className="size-4" />}
                    {dictionary.academyCreateAccount}
                  </Button>
                </form>
              </div>
            </TabsContent>
          </Tabs>

          {visibleError ? (
            <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{visibleError}</span>
            </div>
          ) : null}
          {signupNotice ? (
            <div className="flex gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{signupNotice}</span>
            </div>
          ) : null}
          <div className="rounded-lg border bg-muted/35 p-3 text-xs font-semibold text-muted-foreground">
            {isCheckingSession ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                {dictionary.checkingSession}
              </span>
            ) : (
              dictionary.academyCredentialStorageNote
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
