import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { workspaceApi, type GoogleIntegrationStatus } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import type { WorkspaceModeConfig } from '../modes/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Separator } from './ui/separator';
import { WorkspaceIcon } from './WorkspaceIcon';

interface GoogleIntegrationPanelProps {
  mode: WorkspaceModeConfig;
}

const providerMeta = {
  google_calendar: {
    icon: CalendarClock,
    descriptionKey: 'calendarIntegrationDescription',
    connectKey: 'connectGoogleCalendar',
  },
  google_drive: {
    icon: null,
    iconName: 'google-drive',
    descriptionKey: 'driveIntegrationDescription',
    connectKey: 'connectGoogleDrive',
  },
  gmail: {
    icon: null,
    iconName: 'gmail',
    descriptionKey: 'gmailIntegrationDescription',
    connectKey: 'connectGmail',
  },
  google_chat: {
    icon: null,
    iconName: 'google-chat',
    descriptionKey: 'chatIntegrationDescription',
    connectKey: 'connectGoogleChat',
  },
} as const;

type IntegrationPanelProvider = keyof typeof providerMeta;

function isIntegrationPanelProvider(provider: string): provider is IntegrationPanelProvider {
  return provider in providerMeta;
}

export function GoogleIntegrationPanel({ mode }: GoogleIntegrationPanelProps) {
  const { dictionary } = useLanguage();
  const [statuses, setStatuses] = useState<GoogleIntegrationStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const enabledProviders = useMemo(
    () =>
      mode.integrations
        .map((integration) => integration.provider)
        .filter(isIntegrationPanelProvider),
    [mode.integrations],
  );

  useEffect(() => {
    let isMounted = true;

    workspaceApi
      .getGoogleIntegrations()
      .then((nextStatuses) => {
        if (isMounted) {
          setStatuses(nextStatuses);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (enabledProviders.length === 0) {
    return null;
  }

  const getStatus = (provider: GoogleIntegrationStatus['provider']) =>
    statuses.find((status) => status.provider === provider);
  const hasDrive = enabledProviders.includes('google_drive');

  return (
    <Card className="rounded-xl bg-card shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base font-black">{dictionary.googleWorkspaceTitle}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{dictionary.googleWorkspaceSubtitle}</p>
        </div>
        {isLoading ? (
          <Badge className="gap-1" variant="outline">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            {dictionary.checkingGoogleConfig}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid gap-3 md:grid-cols-2">
          {enabledProviders.map((provider) => {
            const status = getStatus(provider);
            const meta = providerMeta[provider];
            const Icon = meta.icon;
            const iconName = 'iconName' in meta ? meta.iconName : undefined;
            const isConnected = status?.connected ?? false;
            const isConfigured = status?.configured ?? false;

            return (
              <div className="rounded-lg border bg-muted/25 p-4" key={provider}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background">
                      {Icon ? (
                        <Icon aria-hidden="true" className="text-primary" size={20} />
                      ) : (
                        <WorkspaceIcon name={iconName ?? 'link'} size={21} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black">{status?.label ?? provider}</h3>
                      <Badge
                        className="mt-1"
                        variant={isConnected ? 'default' : 'outline'}
                      >
                        {isConnected ? dictionary.googleConnected : dictionary.googleNotConnected}
                      </Badge>
                    </div>
                  </div>
                  {isConnected ? <CheckCircle2 aria-hidden="true" className="size-4 text-primary" /> : null}
                </div>
                <p className="mt-3 min-h-10 text-sm leading-relaxed text-muted-foreground">
                  {dictionary[meta.descriptionKey]}
                </p>
                <Separator className="my-3" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-black uppercase text-muted-foreground">
                    {dictionary.requestedScopes}
                  </span>
                  <span className="text-xs font-bold text-muted-foreground">{status?.scopes.length ?? 0}</span>
                </div>
                <Button
                  asChild={isConfigured}
                  className="mt-3 h-9 w-full rounded-lg font-black"
                  disabled={!isConfigured}
                  type="button"
                  variant={isConnected ? 'secondary' : 'default'}
                >
                  {isConfigured ? (
                    <a href={status?.connectUrl ?? '/api/auth/google/login?forceConsent=true'}>
                      {isConnected ? (
                        <RefreshCw aria-hidden="true" className="size-4" />
                      ) : null}
                      <span>{isConnected ? dictionary.reconnectGoogle : dictionary[meta.connectKey]}</span>
                    </a>
                  ) : (
                    <span>{dictionary.googleNotConnected}</span>
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {hasDrive ? (
          <div className="rounded-lg border bg-muted/25 p-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-background">
                <WorkspaceIcon name="google-drive" size={21} />
              </div>
              <div>
                <h3 className="text-sm font-black">{dictionary.drivePreviewTitle}</h3>
                <p className="text-xs text-muted-foreground">{dictionary.drivePreviewSubtitle}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {dictionary.drivePreviewItems.map((item) => (
                <div className="flex items-center justify-between rounded-lg bg-background/70 px-3 py-2" key={item}>
                  <span className="text-xs font-bold">{item}</span>
                  <WorkspaceIcon className="text-muted-foreground" name="link" size={14} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
