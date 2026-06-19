import { useCallback, useEffect, useState } from 'react';
import { Languages, Maximize2, Minimize2, Moon, Plus, Sun } from 'lucide-react';
import { workspaceApi } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { languageOptions, type Language } from '../i18n';
import { cn } from '../lib/utils';
import type { AppTheme } from '../theme';
import { CanvasConnectionDialog } from './CanvasConnectionDialog';
import { ModeSwitch } from './ModeSwitch';
import { Button } from './ui/button';
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
import { WorkspaceIcon } from './WorkspaceIcon';

interface TopBarProps {
  academyLogoSrc?: string;
  allowedModeIds?: string[];
  isTopBarCollapsed?: boolean;
  onBeforeModeChange?: (modeId: string) => boolean | void;
  onOpenAddItem: () => void;
  onToggleTopBarCollapsed?: () => void;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
}

export function TopBar({
  academyLogoSrc,
  allowedModeIds,
  isTopBarCollapsed = false,
  onBeforeModeChange,
  onOpenAddItem,
  onToggleTopBarCollapsed,
  onThemeChange,
  theme,
}: TopBarProps) {
  const { activeMode, activeModeId, setActiveModeId, visibleModes } = useWorkspaceMode();
  const { dictionary, language, setLanguage, translateModeName, translateModePurpose } = useLanguage();
  const [isCanvasDialogOpen, setIsCanvasDialogOpen] = useState(false);
  const [pendingCanvasModeId, setPendingCanvasModeId] = useState<string | null>(null);
  const isDark = theme === 'dark';
  const activeModeName = translateModeName(activeMode.id, activeMode.displayName);
  const allowedModeIdSet = allowedModeIds ? new Set(allowedModeIds) : null;
  const visibleAllowedModes = allowedModeIdSet
    ? visibleModes.filter((mode) => allowedModeIdSet.has(mode.id))
    : visibleModes;
  const activeModePurpose = translateModePurpose(activeMode.id, activeMode.purpose);
  const isAcademyMode = activeMode.id === 'academy';
  const isAdminConsoleMode = activeMode.id === 'admin-console';
  const showThemeControl = !isAcademyMode;
  const fallbackBrandLogoSrc = '/brand/INCOS%20New%20Logo_Crop.png';
  const defaultAcademyLogoSrc = '/brand/SFU_block_colour_rgb.png';
  const brandLogoAlt = isAcademyMode ? 'SFU' : 'INCOS';
  const isAcademyLogoHidden = isAcademyMode && academyLogoSrc === 'none';
  const brandLogoSrc = isAcademyMode ? (academyLogoSrc || defaultAcademyLogoSrc) : fallbackBrandLogoSrc;
  const brandTitle = isAcademyMode ? dictionary.academyManagerName : dictionary.workspaceName;
  const canCollapseTopBar = (isAcademyMode || isAdminConsoleMode) && Boolean(onToggleTopBarCollapsed);
  const showCollapsedTopBar = canCollapseTopBar && isTopBarCollapsed;
  const searchPlaceholder =
    language === 'ko'
      ? `${activeModeName} ${dictionary.searchSuffix}`
      : `${dictionary.searchPrefix} ${activeModeName.toLowerCase()} ${dictionary.searchSuffix}...`;

  const activateAcademyWhenCanvasConnected = useCallback(async () => {
    if (onBeforeModeChange?.('academy') === false) {
      return false;
    }

    setActiveModeId('academy');

    try {
      const canvasStatus = await workspaceApi.getCanvasIntegration();

      if (canvasStatus.connected) {
        setPendingCanvasModeId(null);
        setIsCanvasDialogOpen(false);
        return true;
      }

      setPendingCanvasModeId('academy');
      setIsCanvasDialogOpen(true);
      return false;
    } catch {
      setPendingCanvasModeId('academy');
      setIsCanvasDialogOpen(true);
      return false;
    }
  }, [onBeforeModeChange, setActiveModeId]);

  const handleModeChange = async (modeId: string) => {
    if (allowedModeIdSet && !allowedModeIdSet.has(modeId)) {
      return;
    }

    if (modeId !== 'academy') {
      if (onBeforeModeChange?.(modeId) === false) {
        return;
      }

      setActiveModeId(modeId);
      setPendingCanvasModeId(null);
      setIsCanvasDialogOpen(false);
      return;
    }

    await activateAcademyWhenCanvasConnected();
  };

  useEffect(() => {
    const requestedModeId = new URLSearchParams(window.location.search).get('mode');

    if (requestedModeId !== 'academy') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void activateAcademyWhenCanvasConnected();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activateAcademyWhenCanvasConnected]);

  return (
    <header
      className={cn(
        'sticky top-0 z-20 border-b bg-card/90 backdrop-blur-xl transition-[height,min-height] duration-300 xl:shrink-0 xl:overflow-hidden',
        showCollapsedTopBar
          ? 'min-h-[42px] xl:h-[42px] xl:min-h-[42px]'
          : 'min-h-[74px] xl:h-[74px] xl:min-h-[74px]',
      )}
    >
      {showCollapsedTopBar ? (
        <div className="flex min-h-[42px] items-center gap-3 px-4 py-1 xl:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {!isAcademyLogoHidden ? (
              <img
                alt={brandLogoAlt}
                className="h-7 w-auto shrink-0 object-contain"
                key={brandLogoSrc}
                onError={(event) => {
                  if (event.currentTarget.dataset.fallbackApplied !== 'true') {
                    event.currentTarget.dataset.fallbackApplied = 'true';
                    event.currentTarget.src = isAcademyMode ? defaultAcademyLogoSrc : fallbackBrandLogoSrc;
                    return;
                  }

                  event.currentTarget.style.visibility = 'hidden';
                }}
                src={brandLogoSrc}
              />
            ) : null}
            <span className="truncate text-sm font-black">{brandTitle}</span>
          </div>
          <button
            aria-label={dictionary.academyTopBarExpand}
            className="group flex h-7 min-w-0 flex-1 items-center justify-center gap-2 rounded-md text-muted-foreground outline-none transition hover:bg-muted/70 hover:text-foreground focus-visible:bg-muted/70 focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={onToggleTopBarCollapsed}
            title={dictionary.academyTopBarExpand}
            type="button"
          >
            <span className="h-1 min-w-8 flex-1 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/60" />
            <span className="hidden shrink-0 items-center gap-1 text-[10px] font-black uppercase group-hover:flex group-focus-visible:flex">
              <Maximize2 aria-hidden="true" className="size-3" strokeWidth={2.5} />
              {dictionary.academyTopBarExpand}
            </span>
            <span className="h-1 min-w-8 flex-1 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/60" />
          </button>
        </div>
      ) : (
        <div className="relative flex min-h-[74px] flex-wrap items-center justify-between gap-4 px-4 py-2 lg:flex-nowrap xl:h-[74px] xl:px-5">
          <div className="flex min-w-0 items-center gap-3 max-[520px]:w-full max-[520px]:gap-2 lg:min-w-[282px]">
            {!isAcademyLogoHidden ? (
              <img
                alt={brandLogoAlt}
                className={isAcademyMode
                  ? 'h-[52px] w-auto shrink-0 object-contain max-[520px]:h-7'
                  : 'h-[38px] w-auto max-w-[220px] shrink-0 object-contain max-[520px]:h-7 max-[520px]:max-w-[128px] sm:max-w-[280px]'}
                key={brandLogoSrc}
                onError={(event) => {
                  if (event.currentTarget.dataset.fallbackApplied !== 'true') {
                    event.currentTarget.dataset.fallbackApplied = 'true';
                    event.currentTarget.src = isAcademyMode ? defaultAcademyLogoSrc : fallbackBrandLogoSrc;
                    return;
                  }

                  event.currentTarget.style.visibility = 'hidden';
                }}
                src={brandLogoSrc}
              />
            ) : null}
            <div className="min-w-0">
              <h1 className="truncate text-base font-black leading-none max-[520px]:text-sm">{brandTitle}</h1>
              <p className="mt-1 hidden max-w-[280px] truncate text-xs text-muted-foreground sm:block">
                {activeModePurpose}
              </p>
            </div>
          </div>

          <div className="max-[520px]:order-3 max-[520px]:w-full">
            <ModeSwitch
              activeModeId={activeModeId}
              modes={visibleAllowedModes}
              onModeChange={(modeId) => {
                void handleModeChange(modeId);
              }}
            />
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 max-[520px]:absolute max-[520px]:right-3 max-[520px]:top-2 max-[520px]:gap-1 lg:min-w-[260px]">
            <label className="hidden w-[240px] max-w-[24vw] items-center gap-2 rounded-lg border bg-muted/60 px-3 py-1.5 text-muted-foreground lg:flex">
              <WorkspaceIcon name="search" size={16} />
              <Input
                className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                placeholder={searchPlaceholder}
              />
            </label>
            <div className="w-[132px] shrink-0 max-[520px]:w-[78px]">
              <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
                <SelectTrigger
                  aria-label={dictionary.language}
                  className="h-10 w-full rounded-lg bg-muted/60 px-2 text-xs font-black max-[520px]:h-8 max-[520px]:rounded-md max-[520px]:px-1.5"
                >
                  <Languages aria-hidden="true" className="mr-1 size-4 text-muted-foreground max-[520px]:mr-0 max-[520px]:size-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end" className="min-w-[132px]" position="popper">
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showThemeControl ? (
              <>
                <div className="hidden items-center gap-2 rounded-lg border bg-muted/60 px-3 py-2 md:flex">
                  <Sun aria-hidden="true" className="text-muted-foreground" size={15} />
                  <Switch
                    aria-label={dictionary.darkMode}
                    checked={isDark}
                    onCheckedChange={(checked) => onThemeChange(checked ? 'dark' : 'light')}
                  />
                  <Moon aria-hidden="true" className={isDark ? 'text-primary' : 'text-muted-foreground'} size={15} />
                  <Label className="sr-only">{dictionary.darkMode}</Label>
                </div>
                <Button
                  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                  className="md:hidden max-[520px]:size-8 max-[520px]:rounded-md"
                  onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
                  size="icon-lg"
                  type="button"
                  variant="outline"
                >
                  {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
                </Button>
              </>
            ) : null}
            <Button
              className="h-10 rounded-lg bg-primary px-4 font-black text-primary-foreground shadow-none hover:bg-primary/90 max-[520px]:hidden"
              onClick={onOpenAddItem}
              type="button"
            >
              <Plus aria-hidden="true" size={18} />
              <span className="hidden sm:inline">{dictionary.add}</span>
            </Button>
          </div>
          {canCollapseTopBar ? (
            <button
              aria-label={dictionary.academyTopBarCollapse}
              className="group absolute bottom-0 left-1/2 flex h-2 w-[min(560px,58vw)] -translate-x-1/2 items-center justify-center rounded-t-md text-muted-foreground outline-none transition-all duration-200 hover:h-5 hover:bg-muted/70 hover:text-foreground focus-visible:h-5 focus-visible:bg-muted/70 focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={onToggleTopBarCollapsed}
              title={dictionary.academyTopBarCollapse}
              type="button"
            >
              <span className="flex w-full items-center justify-center gap-2">
                <span className="h-1 min-w-10 flex-1 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/60" />
                <span className="hidden shrink-0 items-center gap-1 text-[10px] font-black uppercase group-hover:inline-flex group-focus-visible:inline-flex">
                  <Minimize2 aria-hidden="true" className="size-3" strokeWidth={2.5} />
                  {dictionary.academyTopBarCollapse}
                </span>
                <span className="h-1 min-w-10 flex-1 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/60" />
              </span>
            </button>
          ) : null}
        </div>
      )}
      <CanvasConnectionDialog
        onConnected={() => {
          if (pendingCanvasModeId === 'academy') {
            setActiveModeId('academy');
          }

          setPendingCanvasModeId(null);
          setIsCanvasDialogOpen(false);
        }}
        onOpenChange={(open) => {
          setIsCanvasDialogOpen(open);

          if (!open) {
            setPendingCanvasModeId(null);
          }
        }}
        open={isCanvasDialogOpen}
      />
    </header>
  );
}
