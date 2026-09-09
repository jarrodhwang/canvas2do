import { dotColorClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import type { ColorToken } from '../modes/types';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

interface FilterPanelProps {
  className?: string;
  courseOptions: Array<{
    checked: boolean;
    color: ColorToken;
    id: string;
    label: string;
  }>;
  onToggleCourseOption?: (courseId: string) => void;
}

export function FilterPanel({ className, courseOptions, onToggleCourseOption }: FilterPanelProps) {
  return (
    <div aria-label="Course filters" className={cn('min-w-56 space-y-2 p-2', className)}>
      {courseOptions.map((option) => (
        <Label className="flex items-center gap-2 text-sm font-bold text-muted-foreground max-[520px]:min-h-11 max-[520px]:gap-3" key={option.id}>
          <Checkbox
            checked={option.checked}
            onCheckedChange={() => onToggleCourseOption?.(option.id)}
          />
          <span className={cn('h-2.5 w-2.5 rounded-full', dotColorClasses[option.color])} />
          <span className="truncate">{option.label}</span>
        </Label>
      ))}
    </div>
  );
}
