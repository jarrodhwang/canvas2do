import type { ReactNode } from 'react';
import type { ColorToken } from '../modes/types';
import { Badge } from './ui/badge';
import { badgeColorClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';

interface EventPillProps {
  label: ReactNode;
  color?: ColorToken;
  compact?: boolean;
  className?: string;
}

export function EventPill({ label, color = 'blue', compact = false, className }: EventPillProps) {
  return (
    <Badge
      className={cn(
        'max-w-full border font-semibold',
        badgeColorClasses[color],
        compact ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-[11px]',
        className,
      )}
      variant="outline"
    >
      <span className="truncate">{label}</span>
    </Badge>
  );
}
