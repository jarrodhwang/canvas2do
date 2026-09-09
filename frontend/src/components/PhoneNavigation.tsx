import { MoreHorizontal } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import type { SidebarItemConfig } from '../modes/types';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { WorkspaceIcon } from './WorkspaceIcon';

interface PhoneNavigationProps {
  activeItemId: string;
  isTodoActive: boolean;
  items: SidebarItemConfig[];
  onSelectItem: (id: string) => void;
  onSelectTodo: () => void;
}

const primaryItemIds = ['dashboard', 'courses', 'grades'];
const navigationButtonClass = 'mx-auto h-11 w-full max-w-16 rounded-xl p-0';

export function PhoneNavigation({ activeItemId, isTodoActive, items, onSelectItem, onSelectTodo }: PhoneNavigationProps) {
  const { language, translateItemLabel } = useLanguage();
  const primaryItems = items.filter((item) => primaryItemIds.includes(item.id));
  const moreItems = items.filter((item) => !primaryItemIds.includes(item.id));
  const canShowTodo = items.some((item) => item.id === 'dashboard');
  const moreActive = !isTodoActive && moreItems.some((item) => item.id === activeItemId);
  const moreLabel = language === 'ko' ? '더 보기' : 'More';
  const todoLabel = language === 'ko' ? '할 일' : 'To Do';

  return (
    <>
      {primaryItems.map((item) => {
        const active = activeItemId === item.id && !isTodoActive;
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
      {canShowTodo ? (
        <Button
          aria-current={isTodoActive ? 'page' : undefined}
          aria-label={todoLabel}
          className={cn(navigationButtonClass, isTodoActive ? 'bg-primary/15 text-primary hover:bg-primary/15' : 'bg-transparent text-muted-foreground hover:bg-transparent')}
          onClick={onSelectTodo}
          title={todoLabel}
          type="button"
          variant="ghost"
        >
          <WorkspaceIcon className="size-5" name="list-checks" />
        </Button>
      ) : null}
      {moreItems.length > 0 ? (
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
            {moreItems.map((item) => (
              <DropdownMenuItem
                aria-current={activeItemId === item.id && !isTodoActive ? 'page' : undefined}
                className="min-h-11 gap-3 rounded-lg aria-[current=page]:bg-primary/15 aria-[current=page]:text-primary"
                key={item.id}
                onSelect={() => onSelectItem(item.id)}
              >
                <WorkspaceIcon className="size-5" name={item.icon} />
                {translateItemLabel(item.id, item.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
