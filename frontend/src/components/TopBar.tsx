import { GraduationCap, Languages, LogOut, Maximize2, Minimize2, Moon, Pencil, Plus, Sun } from 'lucide-react';

import type { AuthSession } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { languageOptions, type Language } from '../i18n';
import { cn } from '../lib/utils';
import type { AppTheme } from '../theme';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface TopBarProps {
  academyLogoSrc?: string;
  authSession?: AuthSession | null;
  isTopBarCollapsed?: boolean;
  onOpenAddItem: () => void;
  onOpenProfile?: () => void;
  onSignOut?: () => void;
  onToggleTopBarCollapsed?: () => void;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
}

function getInitials(label: string) {
  return label.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

function AccountMenu({
  authSession,
  onOpenProfile,
  onSignOut,
  compact = false,
}: Pick<TopBarProps, 'authSession' | 'onOpenProfile' | 'onSignOut'> & { compact?: boolean }) {
  const { dictionary } = useLanguage();
  const displayName = authSession?.displayName?.trim() || authSession?.email?.trim() || dictionary.accountFallbackName;
  const email = authSession?.email?.trim() || dictionary.notSet;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={dictionary.accountMenu}
          className={cn(
            'flex max-w-[250px] items-center gap-2 rounded-lg border bg-muted/60 px-2 text-left outline-none transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
            compact ? 'h-8' : 'h-11',
          )}
          type="button"
        >
          <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-xs font-black text-primary-foreground', compact ? 'size-6' : 'size-8')}>
            {getInitials(displayName)}
          </span>
          <span className="min-w-0 max-[520px]:hidden">
            <span className="block truncate text-xs font-black">{displayName}</span>
            {!compact ? <span className="block truncate text-[10px] font-semibold text-muted-foreground">{email}</span> : null}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="min-w-0 px-2 py-2">
          <div className="truncate text-sm font-black">{displayName}</div>
          <div className="truncate text-xs font-semibold text-muted-foreground">{email}</div>
          {authSession?.isAdmin ? <div className="mt-1 text-[10px] font-black uppercase text-primary">Administrator</div> : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!onOpenProfile} onSelect={() => onOpenProfile?.()}>
          <Pencil className="size-4" /> Edit profile & security
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!onSignOut} onSelect={() => onSignOut?.()} variant="destructive">
          <LogOut className="size-4" /> {dictionary.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar({
  academyLogoSrc,
  authSession,
  isTopBarCollapsed = false,
  onOpenAddItem,
  onOpenProfile,
  onSignOut,
  onToggleTopBarCollapsed,
  onThemeChange,
  theme,
}: TopBarProps) {
  const { dictionary, language, setLanguage } = useLanguage();
  const showCustomLogo = Boolean(academyLogoSrc && academyLogoSrc !== 'none');

  if (isTopBarCollapsed) {
    return (
      <header className="sticky top-0 z-20 flex min-h-[42px] items-center gap-3 border-b bg-card/90 px-4 py-1 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          {showCustomLogo ? <img alt="Canvas To Do" className="h-7 w-auto object-contain" src={academyLogoSrc} /> : <GraduationCap className="size-5 text-primary" />}
          <span className="truncate text-sm font-black">Canvas To Do</span>
        </div>
        <button
          aria-label={dictionary.academyTopBarExpand}
          className="group mx-auto flex h-7 min-w-32 flex-1 items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
          onClick={onToggleTopBarCollapsed}
          type="button"
        >
          <span className="h-1 flex-1 rounded-full bg-border" />
          <Maximize2 className="size-3" />
          <span className="h-1 flex-1 rounded-full bg-border" />
        </button>
        <AccountMenu authSession={authSession} compact onOpenProfile={onOpenProfile} onSignOut={onSignOut} />
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 relative flex min-h-[74px] items-center justify-between gap-3 border-b bg-card/90 px-4 py-2 backdrop-blur-xl xl:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {showCustomLogo ? (
          <img alt="Canvas To Do" className="h-11 max-w-[200px] shrink-0 object-contain" src={academyLogoSrc} />
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-6" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-base font-black leading-tight">Canvas To Do</h1>
          <p className="truncate text-xs font-semibold text-muted-foreground max-[640px]:hidden">Your academic calendar</p>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
          <SelectTrigger aria-label={dictionary.language} className="h-10 w-[78px] px-2 text-xs font-black max-[520px]:hidden">
            <Languages className="mr-1 size-4" /><SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {languageOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.shortLabel}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          size="icon"
          type="button"
          variant="outline"
        >
          {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
        <Button className="font-black max-[520px]:hidden" onClick={onOpenAddItem} type="button">
          <Plus className="size-4" /> {dictionary.add}
        </Button>
        <AccountMenu authSession={authSession} onOpenProfile={onOpenProfile} onSignOut={onSignOut} />
      </div>
      {onToggleTopBarCollapsed ? (
        <button
          aria-label={dictionary.academyTopBarCollapse}
          className="group absolute bottom-0 left-1/2 flex h-2 w-[min(560px,58vw)] -translate-x-1/2 items-center justify-center text-muted-foreground hover:h-5 hover:bg-muted/70"
          onClick={onToggleTopBarCollapsed}
          type="button"
        >
          <span className="h-1 flex-1 rounded-full bg-border" /><Minimize2 className="mx-2 size-3" /><span className="h-1 flex-1 rounded-full bg-border" />
        </button>
      ) : null}
    </header>
  );
}
