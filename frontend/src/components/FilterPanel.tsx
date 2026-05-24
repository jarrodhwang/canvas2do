import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { useLanguage } from '../context/LanguageContext';
import { dotColorClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

export function FilterPanel() {
  const { activeMode } = useWorkspaceMode();
  const { translateItemLabel } = useLanguage();

  return (
    <Card
      className="hidden rounded-xl bg-muted/25 shadow-none lg:block"
      aria-label={`${activeMode.displayName} filters`}
    >
      <CardContent className="space-y-5 p-4">
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
      </CardContent>
    </Card>
  );
}
