import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { useLanguage } from '../context/LanguageContext';
import { dotColorClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

interface FilterPanelProps {
  className?: string;
  variant?: 'card' | 'menu';
}

export function FilterPanel({ className, variant = 'card' }: FilterPanelProps) {
  const { activeMode } = useWorkspaceMode();
  const { translateItemLabel } = useLanguage();
  const content = (
    <div className="space-y-5">
      {activeMode.filters.map((group) => (
        <div key={group.id}>
          <div className="mb-2 text-[11px] font-black uppercase text-muted-foreground">
            {translateItemLabel(group.id, group.label)}
          </div>
          <div className="space-y-2">
            {group.options.map((option) => (
              <Label className="flex items-center gap-2 text-sm font-bold text-muted-foreground" key={option.id}>
                <Checkbox defaultChecked={option.defaultChecked} />
                <span className={cn('h-2.5 w-2.5 rounded-full', dotColorClasses[option.color])} />
                <span>{translateItemLabel(option.id, option.label)}</span>
              </Label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  if (variant === 'menu') {
    return (
      <div
        aria-label={`${activeMode.displayName} filters`}
        className={cn('min-w-56 p-2', className)}
      >
        {content}
      </div>
    );
  }

  return (
    <Card
      className={cn('rounded-xl bg-muted/25 shadow-none', className)}
      aria-label={`${activeMode.displayName} filters`}
    >
      <CardContent className="p-4">
        {content}
      </CardContent>
    </Card>
  );
}
