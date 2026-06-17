import { useState } from 'react';
import { AlertCircle, Languages, Loader2, Moon, Sun } from 'lucide-react';
import { workspaceApi } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { languageOptions, type Language } from '../i18n';
import type { AppTheme } from '../theme';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Switch } from './ui/switch';

interface LoginPageProps {
  authMessage?: string | null;
  isCheckingSession: boolean;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
}

export function LoginPage({ authMessage, isCheckingSession, onThemeChange, theme }: LoginPageProps) {
  const { dictionary, language, setLanguage } = useLanguage();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const isDark = theme === 'dark';
  const visibleError = loginError ?? authMessage;

  const handleGoogleLogin = async () => {
    setLoginError(null);
    setIsStartingLogin(true);

    try {
      const config = await workspaceApi.getAuthConfig();

      if (!config.googleConfigured) {
        setLoginError(dictionary.googleOAuthNotConfigured);
        setIsStartingLogin(false);
        return;
      }

      window.location.assign(workspaceApi.getGoogleLoginUrl('/'));
    } catch {
      setLoginError(dictionary.googleOAuthNotConfigured);
      setIsStartingLogin(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-[560px] rounded-xl bg-card shadow-none">
        <CardHeader className="gap-6 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <img
              alt="INCOS"
              className="h-16 w-auto max-w-[280px] object-contain sm:h-[74px] sm:max-w-[340px]"
              src="/brand/INCOS%20New%20Logo_Crop.png"
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
              {dictionary.loginSubtitle}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6 sm:px-7 sm:pb-7">
          <Button
            disabled={isStartingLogin}
            onClick={handleGoogleLogin}
            className="h-12 w-full justify-center gap-2 rounded-lg bg-primary text-sm font-black text-primary-foreground hover:bg-primary/90"
            type="button"
          >
            <>
              <span className="grid size-5 place-items-center rounded bg-primary-foreground text-xs font-black text-primary">
                {isStartingLogin ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : 'G'}
              </span>
              <span>
                {isStartingLogin
                  ? dictionary.checkingGoogleConfig
                  : dictionary.continueWithWorkspaceGoogle}
              </span>
            </>
          </Button>
          {visibleError ? (
            <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{visibleError}</span>
            </div>
          ) : null}
          <div className="rounded-lg border bg-muted/35 p-3 text-xs font-semibold text-muted-foreground">
            {isCheckingSession ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                {dictionary.checkingSession}
              </span>
            ) : (
              dictionary.loginProviderNote
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
