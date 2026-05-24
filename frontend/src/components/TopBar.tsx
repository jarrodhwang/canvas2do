import { useCallback, useEffect, useState } from 'react';
import { Languages, Moon, Plus, Sun } from 'lucide-react';
import { workspaceApi } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { languageOptions, type Language } from '../i18n';
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
  onOpenAddItem: () => void;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
}

export function TopBar({ onOpenAddItem, onThemeChange, theme }: TopBarProps) {
  const { activeMode, activeModeId, setActiveModeId, visibleModes } = useWorkspaceMode();
  const { dictionary, language, setLanguage, translateModeName, translateModePurpose } = useLanguage();
  const [isCanvasDialogOpen, setIsCanvasDialogOpen] = useState(false);
  const [pendingCanvasModeId, setPendingCanvasModeId] = useState<string | null>(null);
  const isDark = theme === 'dark';
  const activeModeName = translateModeName(activeMode.id, activeMode.displayName);
  const activeModePurpose = translateModePurpose(activeMode.id, activeMode.purpose);
  const isAcademyMode = activeMode.id === 'academy';
  const brandLogoAlt = isAcademyMode ? 'SFU' : 'INCOS';
  const brandLogoSrc = isAcademyMode ? '/brand/SFU_block_colour_rgb.png' : '/brand/INCOS%20New%20Logo_Crop.png';
  const brandTitle = isAcademyMode ? dictionary.academyManagerName : dictionary.workspaceName;
  const searchPlaceholder =
    language === 'ko'
      ? `${activeModeName} ${dictionary.searchSuffix}`
      : `${dictionary.searchPrefix} ${activeModeName.toLowerCase()} ${dictionary.searchSuffix}...`;

  const activateAcademyWhenCanvasConnected = useCallback(async () => {
    const canvasStatus = await workspaceApi.getCanvasIntegration();

    if (canvasStatus.connected) {
      setActiveModeId('academy');
      setPendingCanvasModeId(null);
      setIsCanvasDialogOpen(false);
      return true;
    }

    setPendingCanvasModeId('academy');
    setIsCanvasDialogOpen(true);
    return false;
  }, [setActiveModeId]);

  const handleModeChange = async (modeId: string) => {
    if (modeId !== 'academy') {
      setActiveModeId(modeId);
      return;
    }

    await activateAcademyWhenCanvasConnected();
  };

  useEffect(() => {
    const requestedModeId = new URLSearchParams(window.location.search).get('mode');

    if (requestedModeId !== 'academy') {
      return;
    }

    void activateAcademyWhenCanvasConnected();
  }, [activateAcademyWhenCanvasConnected]);

  return (
    <header className="sticky top-0 z-20 flex min-h-[74px] flex-wrap items-center justify-between gap-4 border-b bg-card/90 px-4 py-2 backdrop-blur-xl lg:flex-nowrap xl:h-[74px] xl:min-h-[74px] xl:shrink-0 xl:overflow-hidden xl:px-5">
      <div className="flex min-w-0 items-center gap-3 lg:min-w-[282px]">
        <img
          alt={brandLogoAlt}
          className={isAcademyMode
            ? 'h-[52px] w-auto shrink-0 object-contain'
            : 'h-[38px] w-auto max-w-[220px] shrink-0 object-contain sm:max-w-[280px]'}
          onError={(event) => {
            const fallbackSrc = '/brand/INCOS%20New%20Logo_crop.png';

            if (isAcademyMode) {
              event.currentTarget.hidden = true;
              return;
            }

            if (!event.currentTarget.src.endsWith(fallbackSrc)) {
              event.currentTarget.src = fallbackSrc;
              return;
            }

            event.currentTarget.hidden = true;
          }}
          src={brandLogoSrc}
        />
        <div className="min-w-0">
          <h1 className="text-base font-black leading-none">{brandTitle}</h1>
          <p className="mt-1 hidden max-w-[280px] truncate text-xs text-muted-foreground sm:block">
            {activeModePurpose}
          </p>
        </div>
      </div>

      <ModeSwitch
        activeModeId={activeModeId}
        modes={visibleModes}
        onModeChange={(modeId) => {
          void handleModeChange(modeId);
        }}
      />

      <div className="flex min-w-0 items-center justify-end gap-2 lg:min-w-[260px]">
        <label className="hidden w-[240px] max-w-[24vw] items-center gap-2 rounded-lg border bg-muted/60 px-3 py-1.5 text-muted-foreground lg:flex">
          <WorkspaceIcon name="search" size={16} />
          <Input
            className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            placeholder={searchPlaceholder}
          />
        </label>
        <div className="w-[132px] shrink-0">
          <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
            <SelectTrigger
              aria-label={dictionary.language}
              className="h-10 w-full rounded-lg bg-muted/60 px-2 text-xs font-black"
            >
              <Languages aria-hidden="true" className="mr-1 size-4 text-muted-foreground" />
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
          className="md:hidden"
          onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
          size="icon-lg"
          type="button"
          variant="outline"
        >
          {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </Button>
        <Button
          className="h-10 rounded-lg bg-primary px-4 font-black text-primary-foreground shadow-none hover:bg-primary/90"
          onClick={onOpenAddItem}
          type="button"
        >
          <Plus aria-hidden="true" size={18} />
          <span className="hidden sm:inline">{dictionary.add}</span>
        </Button>
      </div>
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
