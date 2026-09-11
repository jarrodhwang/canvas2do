import { MoreHorizontal, UserRound, LogOut, Plus } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import type { SidebarItemConfig } from '../modes/types';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { WorkspaceIcon } from './WorkspaceIcon';

interface PhoneNavigationProps {
  activeItemId: string;
  isCourseworkActive: boolean;
  items: SidebarItemConfig[];
  onSelectItem: (id: string) => void;
  onSelectCoursework: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  onOpenAddItem: () => void;
}

const primaryItemIds = ['dashboard', 'courses', 'grades'];
const navigationButtonClass = 'mx-auto h-11 w-full max-w-16 rounded-xl p-0';

export function PhoneNavigation({ activeItemId, isCourseworkActive, items, onSelectItem, onSelectCoursework, onOpenProfile, onSignOut, onOpenAddItem }: PhoneNavigationProps) {
  const { dictionary, language, translateItemLabel } = useLanguage();
  const primaryItems = items.filter((item) => primaryItemIds.includes(item.id));
  const moreItems = items.filter((item) => !primaryItemIds.includes(item.id));
  const canShowCoursework = items.some((item) => item.id === 'dashboard');
  const moreActive = !isCourseworkActive && moreItems.some((item) => item.id === activeItemId);
  const moreLabel = language === 'ko' ? '더 보기' : 'More';
  const courseworkLabel = dictionary.courseworkCardSettingsTitle;

  return (
    <>
      {primaryItems.map((item) => {
        const active = activeItemId === item.id && !isCourseworkActive;
        const label = translateItemLabel(item.id, item.label);
        return (
          <Button
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            className={cn(navigationButtonClass, active ? 'bg-primary/15 text-primary hover:bg-primary/15' : 'bg-transparent text-muted-foreground hover:bg-transparent')}
            key={item.id}
            onClick={() => onSelectItem(item.id)}
            title={label}
            type="button"
            variant="ghost"
          >
            <WorkspaceIcon className="size-5" name={item.icon} />
          </Button>
        );
      })}
      {canShowCoursework ? (
        <Button
          aria-current={isCourseworkActive ? 'page' : undefined}
          aria-label={courseworkLabel}
          className={cn(navigationButtonClass, isCourseworkActive ? 'bg-primary/15 text-primary hover:bg-primary/15' : 'bg-transparent text-muted-foreground hover:bg-transparent')}
          onClick={onSelectCoursework}
          title={courseworkLabel}
          type="button"
          variant="ghost"
        >
          <WorkspaceIcon className="size-5" name="list-checks" />
        </Button>
      ) : null}
      {(
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={moreLabel}
              className={cn(navigationButtonClass, moreActive ? 'bg-primary/15 text-primary hover:bg-primary/15' : 'bg-transparent text-muted-foreground hover:bg-transparent')}
              title={moreLabel}
              type="button"
              variant="ghost"
            >
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-2rem)] p-2" side="top" sideOffset={12}>
            <DropdownMenuItem className="min-h-11 gap-3 rounded-lg" onSelect={onOpenProfile}>
              <UserRound className="size-5" /> {language === 'ko' ? '프로필 및 보안' : 'Profile & security'}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 gap-3 rounded-lg" onSelect={onOpenAddItem}>
              <Plus className="size-5" /> {dictionary.add}
            </DropdownMenuItem>
            {moreItems.map((item) => (
              <DropdownMenuItem
                aria-current={activeItemId === item.id && !isCourseworkActive ? 'page' : undefined}
                className="min-h-11 gap-3 rounded-lg aria-[current=page]:bg-primary/15 aria-[current=page]:text-primary"
                key={item.id}
                onSelect={() => onSelectItem(item.id)}
              >
                <WorkspaceIcon className="size-5" name={item.icon} />
                {translateItemLabel(item.id, item.label)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem className="min-h-11 gap-3 rounded-lg" onSelect={onSignOut} variant="destructive">
              <LogOut className="size-5" /> {dictionary.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
