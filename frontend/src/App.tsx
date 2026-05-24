import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { workspaceApi } from './api/workspaceApi';
import type { GoogleDriveFile } from './api/workspaceApi';
import { AddItemModal } from './components/AddItemModal';
import { CalendarShell } from './components/CalendarShell';
import { DashboardCards } from './components/DashboardCards';
import { DetailPanel } from './components/DetailPanel';
import { DriveDetailPanel } from './components/DriveDetailPanel';
import { DriveFilesView } from './components/DriveFilesView';
import { GoogleCommunicationView } from './components/GoogleCommunicationView';
import { LoginPage } from './components/LoginPage';
import { OutlookEmailView } from './components/OutlookEmailView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Button } from './components/ui/button';
import { WorkspaceIcon } from './components/WorkspaceIcon';
import { useLanguage } from './context/LanguageContext';
import { useWorkspaceMode } from './context/WorkspaceModeContext';
import { cn } from './lib/utils';
import type { WorkspaceView } from './modes/types';
import { applyTheme, getInitialTheme, type AppTheme } from './theme';

interface WorkspaceNavigation {
  modeId: string;
  sidebarItemId: string;
  view: WorkspaceView;
}

interface WorkspaceHistoryState {
  source: 'incos-workspace';
  navigation: WorkspaceNavigation;
}

interface DriveBrowserHistoryState {
  source: 'incos-drive-browser';
}

function isWorkspaceHistoryState(value: unknown): value is WorkspaceHistoryState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Partial<WorkspaceHistoryState>;

  return state.source === 'incos-workspace'
    && Boolean(state.navigation)
    && typeof state.navigation?.modeId === 'string'
    && typeof state.navigation?.sidebarItemId === 'string'
    && typeof state.navigation?.view === 'string';
}

function isDriveBrowserHistoryState(value: unknown): value is DriveBrowserHistoryState {
  return Boolean(value)
    && typeof value === 'object'
    && (value as Partial<DriveBrowserHistoryState>).source === 'incos-drive-browser';
}

function App() {
  const { activeData, activeMode } = useWorkspaceMode();
  const { dictionary } = useLanguage();
  const [navigation, setNavigation] = useState<WorkspaceNavigation>({
    modeId: '',
    sidebarItemId: 'calendar',
    view: 'month',
  });
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWorkspaceSidebarCollapsed, setIsWorkspaceSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(getInitialTheme);
  const [selectedDriveItem, setSelectedDriveItem] = useState<GoogleDriveFile | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const hasAppliedUrlNavigationRef = useRef(false);
  const activeSidebarItem = navigation.modeId === activeMode.id ? navigation.sidebarItemId : 'calendar';
  const activeView = navigation.modeId === activeMode.id ? navigation.view : 'month';
  const currentView = activeMode.views.includes(activeView) ? activeView : (activeMode.views[0] ?? 'month');
  const isDriveView = activeSidebarItem === 'drive';
  const isEmailView = activeSidebarItem === 'email';
  const isOutlookView = activeSidebarItem === 'outlook';
  const isChatView = activeSidebarItem === 'chat';
  const isCommunicationView = isEmailView || isOutlookView || isChatView;
  const mainGridColumnsClass = isCommunicationView
    ? isWorkspaceSidebarCollapsed
      ? 'grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[78px_minmax(0,1fr)]'
      : 'grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[230px_minmax(0,1fr)]'
    : isWorkspaceSidebarCollapsed
      ? 'grid-cols-[72px_minmax(0,1fr)_300px] xl:grid-cols-[78px_minmax(0,1fr)_320px] 2xl:grid-cols-[82px_minmax(0,1fr)_340px] max-xl:grid-cols-[72px_minmax(0,1fr)]'
      : 'grid-cols-[200px_minmax(0,1fr)_300px] xl:grid-cols-[220px_minmax(0,1fr)_320px] 2xl:grid-cols-[230px_minmax(0,1fr)_340px] max-xl:grid-cols-[200px_minmax(0,1fr)]';

  const navigateWorkspace = (nextNavigation: WorkspaceNavigation) => {
    const isSameNavigation =
      navigation.modeId === nextNavigation.modeId
      && navigation.sidebarItemId === nextNavigation.sidebarItemId
      && navigation.view === nextNavigation.view;

    if (isSameNavigation) {
      return;
    }

    if (!isApplyingHistoryRef.current) {
      window.history.pushState(
        {
          source: 'incos-workspace',
          navigation: nextNavigation,
        } satisfies WorkspaceHistoryState,
        '',
        window.location.href,
      );
    }

    setNavigation(nextNavigation);
  };

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.title = dictionary.workspaceName;
  }, [dictionary.workspaceName]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }

    if (!hasAppliedUrlNavigationRef.current) {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedModeId = searchParams.get('mode');
      const requestedSidebarItemId = searchParams.get('item');

      if (requestedModeId === activeMode.id && requestedSidebarItemId) {
        hasAppliedUrlNavigationRef.current = true;
        setNavigation({
          modeId: activeMode.id,
          sidebarItemId: requestedSidebarItemId,
          view: currentView,
        });
        return;
      }
    }

    const currentHistoryState = window.history.state;

    if (isWorkspaceHistoryState(currentHistoryState)) {
      const nextNavigation = currentHistoryState.navigation;
      const isSameNavigation =
        navigation.modeId === nextNavigation.modeId
        && navigation.sidebarItemId === nextNavigation.sidebarItemId
        && navigation.view === nextNavigation.view;

      if (!isSameNavigation) {
        window.setTimeout(() => setNavigation(nextNavigation), 0);
      }
      return;
    }

    if (isDriveBrowserHistoryState(currentHistoryState)) {
      if (activeSidebarItem !== 'drive') {
        window.setTimeout(
          () =>
            setNavigation({
              modeId: activeMode.id,
              sidebarItemId: 'drive',
              view: currentView,
            }),
          0,
        );
      }
      return;
    }

    window.history.replaceState(
      {
        source: 'incos-workspace',
        navigation: {
          modeId: activeMode.id,
          sidebarItemId: activeSidebarItem,
          view: currentView,
        },
      } satisfies WorkspaceHistoryState,
      '',
      window.location.href,
    );
  }, [activeMode.id, activeSidebarItem, authStatus, currentView, navigation]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return undefined;
    }

    const handlePopState = (event: PopStateEvent) => {
      if (isWorkspaceHistoryState(event.state)) {
        isApplyingHistoryRef.current = true;
        setNavigation(event.state.navigation);
        setSelectedDriveItem(null);
        window.setTimeout(() => {
          isApplyingHistoryRef.current = false;
        }, 0);
        return;
      }

      if (isDriveBrowserHistoryState(event.state)) {
        isApplyingHistoryRef.current = true;
        setNavigation({
          modeId: activeMode.id,
          sidebarItemId: 'drive',
          view: currentView,
        });
        setSelectedDriveItem(null);
        window.setTimeout(() => {
          isApplyingHistoryRef.current = false;
        }, 0);
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeMode.id, authStatus, currentView]);

  useEffect(() => {
    let isMounted = true;

    workspaceApi
      .getAuthSession()
      .then((session) => {
        if (isMounted) {
          setAuthStatus(session.isAuthenticated ? 'authenticated' : 'unauthenticated');
        }
      })
      .catch(() => {
        if (isMounted) {
          setAuthStatus('unauthenticated');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (authStatus !== 'authenticated') {
    return (
      <LoginPage
        isCheckingSession={authStatus === 'checking'}
        onThemeChange={setTheme}
        theme={theme}
      />
    );
  }

  return (
    <div
      className="min-h-screen xl:h-screen xl:overflow-hidden"
      style={
        {
          '--mode-accent': activeMode.accent.primary,
          '--mode-accent-2': activeMode.accent.secondary,
          '--workspace-accent': activeMode.accent.primary,
          '--workspace-accent-2': activeMode.accent.secondary,
        } as CSSProperties
      }
    >
      <TopBar
        onOpenAddItem={() => setIsAddModalOpen(true)}
        onThemeChange={setTheme}
        theme={theme}
      />

      <main
        className={cn(
          'mx-auto grid w-full max-w-[2400px] items-start gap-3 overflow-x-clip p-3 xl:h-[calc(100vh-74px)] xl:grid-rows-1 xl:items-stretch xl:overflow-hidden max-lg:block',
          mainGridColumnsClass,
        )}
      >
        <Sidebar
          activeItemId={activeSidebarItem}
          collapsed={isWorkspaceSidebarCollapsed}
          onToggleCollapsed={() => setIsWorkspaceSidebarCollapsed((current) => !current)}
          onSelectItem={(itemId) => {
            if (itemId !== 'drive') {
              setSelectedDriveItem(null);
            }

            let nextView = currentView;

            if (itemId === 'calendar') {
              nextView = 'month';
            }

            if (itemId === 'board') {
              nextView = 'board';
            }

            if (itemId === 'timeline') {
              nextView = 'timeline';
            }

            navigateWorkspace({
              modeId: activeMode.id,
              sidebarItemId: itemId,
              view: nextView,
            });
          }}
        />
        <section
          className={cn(
            'grid w-full min-w-0 gap-4 xl:h-full xl:min-h-0 xl:overflow-x-hidden xl:pr-1 max-lg:gap-3',
            isCommunicationView ? 'content-stretch xl:overflow-hidden' : 'content-start xl:overflow-y-auto',
          )}
        >
          {isDriveView ? (
            <DriveFilesView onSelectedItemChange={setSelectedDriveItem} />
          ) : isEmailView ? (
            <GoogleCommunicationView key="email" type="email" />
          ) : isOutlookView ? (
            <OutlookEmailView />
          ) : isChatView ? (
            <GoogleCommunicationView key="chat" type="chat" />
          ) : (
            <>
              <div className="dashboard-summary-cards">
                <DashboardCards
                  onOpenAddItem={() => setIsAddModalOpen(true)}
                  onPlanMeeting={() => {
                    window.open(
                      'https://calendar.google.com/calendar/u/0/r/eventedit',
                      '_blank',
                      'noopener,noreferrer',
                    );
                  }}
                  onStartMeetingNow={() => {
                    window.open('https://meet.google.com/new', '_blank', 'noopener,noreferrer');
                  }}
                  onWriteInPersonMeetingReport={() => {
                    window.open('https://docs.new', '_blank', 'noopener,noreferrer');
                  }}
                />
              </div>
              <CalendarShell
                data={activeData}
                mode={activeMode}
                onSelectItem={() => undefined}
                onViewChange={(view) =>
                  navigateWorkspace({
                    modeId: activeMode.id,
                    sidebarItemId: view === 'board' || view === 'timeline' ? view : 'calendar',
                    view,
                  })
                }
                view={currentView}
              />
            </>
          )}
        </section>
        {isDriveView ? (
          <DriveDetailPanel item={selectedDriveItem} />
        ) : isCommunicationView ? null : (
          <DetailPanel item={activeData.detailItem} mode={activeMode} />
        )}
      </main>

      <nav
        className="sticky bottom-0 z-30 hidden grid-cols-4 gap-2 border-t bg-card/90 p-2 backdrop-blur-xl max-lg:grid"
        aria-label="Mobile workspace navigation"
      >
        <Button className="h-10 rounded-lg bg-primary text-primary-foreground" type="button" variant="ghost">
          <WorkspaceIcon name="layout-dashboard" size={16} />
          <span>{dictionary.mobileHome}</span>
        </Button>
        <Button className="h-10 rounded-lg bg-muted/60 text-muted-foreground" type="button" variant="ghost">
          <WorkspaceIcon name="calendar-days" size={16} />
          <span>{dictionary.mobileCalendar}</span>
        </Button>
        <Button className="h-10 rounded-lg bg-muted/60 text-muted-foreground" type="button" variant="ghost">
          <WorkspaceIcon name="list-checks" size={16} />
          <span>{dictionary.mobileTasks}</span>
        </Button>
        <Button className="h-10 rounded-lg bg-muted/60 text-muted-foreground" type="button" variant="ghost">
          <WorkspaceIcon name="settings" size={16} />
          <span>{dictionary.mobileMore}</span>
        </Button>
      </nav>

      <AddItemModal
        mode={activeMode}
        onClose={() => setIsAddModalOpen(false)}
        open={isAddModalOpen}
      />
    </div>
  );
}

export default App;
