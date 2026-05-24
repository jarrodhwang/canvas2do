import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { WorkspaceIcon } from './WorkspaceIcon';

interface SidebarProps {
  activeItemId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectItem: (itemId: string) => void;
}

export function Sidebar({ activeItemId, collapsed, onSelectItem, onToggleCollapsed }: SidebarProps) {
  const { activeMode } = useWorkspaceMode();
  const {
    dictionary,
    translateItemLabel,
    translateModeName,
    translateSectionLabel,
  } = useLanguage();
  const modeName = translateModeName(activeMode.id, activeMode.displayName);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <Card className="sticky top-[92px] hidden min-h-[calc(100vh-110px)] w-full min-w-0 self-start overflow-hidden rounded-xl bg-card shadow-none lg:block xl:static xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:self-stretch">
      <CardHeader className={cn('px-3', collapsed && 'px-2')}>
        <Button
          aria-label={collapsed ? dictionary.workspaceExpandSidebar : dictionary.workspaceCollapseSidebar}
          className={cn(
            'h-10 w-full min-w-0 justify-start gap-2 rounded-lg px-2 text-base font-black',
            collapsed && 'justify-center px-0',
          )}
          onClick={onToggleCollapsed}
          title={collapsed ? dictionary.workspaceExpandSidebar : dictionary.workspaceCollapseSidebar}
          type="button"
          variant="ghost"
        >
          <WorkspaceIcon className="shrink-0" name={activeMode.icon} />
          <span className={cn('min-w-0 flex-1 truncate text-left', collapsed && 'hidden')}>
            {modeName}
          </span>
          <ToggleIcon className={cn('size-4 shrink-0 text-muted-foreground', collapsed && 'hidden')} />
        </Button>
      </CardHeader>
      <CardContent className={cn('px-3 xl:min-h-0 xl:flex-1', collapsed && 'px-2')}>
        <ScrollArea className={cn('h-[calc(100vh-190px)] xl:h-full', collapsed ? 'pr-0' : 'pr-2')}>
          {activeMode.sidebar.map((section) => (
            <div className="mb-5" key={section.id}>
              <div
                className={cn(
                  'mb-2 px-3 text-[11px] font-black uppercase text-muted-foreground',
                  collapsed && 'sr-only',
                )}
              >
                {translateSectionLabel(section.id, section.label)}
              </div>
              <div className="grid gap-1">
                {section.items.map((item) => {
                  const active = item.id === activeItemId;

                  return (
                    <Button
                      className={cn(
                        'h-10 w-full min-w-0 justify-start gap-2 rounded-lg px-3 text-sm font-bold',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'text-muted-foreground hover:bg-muted',
                      )}
                      key={item.id}
                      onClick={() => onSelectItem(item.id)}
                      title={translateItemLabel(item.id, item.label)}
                      type="button"
                      variant="ghost"
                    >
                      <WorkspaceIcon className="shrink-0" name={item.icon} size={17} />
                      <span className={cn('truncate', collapsed && 'hidden')}>
                        {translateItemLabel(item.id, item.label)}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
