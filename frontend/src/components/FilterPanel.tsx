import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { useLanguage } from '../context/LanguageContext';
import { dotColorClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import type { ColorToken } from '../modes/types';
import { Card, CardContent } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

interface FilterPanelProps {
  className?: string;
  courseOptions?: Array<{
    checked: boolean;
    color: ColorToken;
    id: string;
    label: string;
  }>;
  onToggleCourseOption?: (courseId: string) => void;
  variant?: 'card' | 'menu';
}

export function FilterPanel({
  className,
  courseOptions,
  onToggleCourseOption,
  variant = 'card',
}: FilterPanelProps) {
  const { activeMode } = useWorkspaceMode();
  const { translateItemLabel } = useLanguage();
  const semesterLabel = activeMode.dashboardCards.find((card) => card.id === 'semester-lectures')?.pill;
  const filterGroups = activeMode.id === 'academy' && variant === 'menu'
    ? activeMode.filters.filter((group) => group.id === 'courses')
    : activeMode.filters;

  const renderOption = (option: typeof activeMode.filters[number]['options'][number]) => {
    const color = option.color;

    return (
      <Label className="flex items-center gap-2 text-sm font-bold text-muted-foreground" key={option.id}>
        <Checkbox defaultChecked={option.defaultChecked} />
        <span className={cn('h-2.5 w-2.5 rounded-full', dotColorClasses[color])} />
        <span>{translateItemLabel(option.id, option.label)}</span>
      </Label>
    );
  };
  const renderCourseOption = (option: NonNullable<FilterPanelProps['courseOptions']>[number]) => (
    <Label className="flex items-center gap-2 text-sm font-bold text-muted-foreground" key={option.id}>
      <Checkbox
        checked={option.checked}
        onCheckedChange={() => onToggleCourseOption?.(option.id)}
      />
      <span className={cn('h-2.5 w-2.5 rounded-full', dotColorClasses[option.color])} />
      <span className="truncate">{option.label}</span>
    </Label>
  );

  const content = (
    <div className="space-y-5">
      {filterGroups.map((group) => (
        <div key={group.id}>
          <div className="mb-2 text-[11px] font-black uppercase text-muted-foreground">
            {translateItemLabel(group.id, group.label)}
          </div>
          {variant === 'menu' && activeMode.id === 'academy' && group.id === 'courses' && semesterLabel ? (
            <div className="rounded-lg border bg-muted/25 p-2">
              <div className="mb-2 px-1 text-[11px] font-black text-foreground">
                {semesterLabel}
              </div>
              <div className="space-y-2">
                {(courseOptions && courseOptions.length > 0
                  ? courseOptions.map(renderCourseOption)
                  : group.options.map(renderOption))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {group.options.map(renderOption)}
            </div>
          )}
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
