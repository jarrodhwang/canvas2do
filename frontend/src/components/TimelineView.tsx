import type { TimelineItem } from '../data/mockWorkspaceData';
import { trackGradientClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import { Card } from './ui/card';

interface TimelineViewProps {
  label: string;
  items: TimelineItem[];
}

export function TimelineView({ label, items }: TimelineViewProps) {
  return (
    <Card className="min-h-[440px] rounded-xl bg-card p-4 shadow-none">
      <div className="mb-2 text-[11px] font-black uppercase text-muted-foreground">{label}</div>
      {items.map((item) => (
        <div className="grid grid-cols-[170px_minmax(0,1fr)] items-center gap-3 border-b py-4 last:border-b-0 max-sm:grid-cols-1" key={item.id}>
          <div className="text-sm font-black">{item.name}</div>
          <div className="relative h-9 overflow-hidden rounded-lg bg-muted">
            <span
              className={cn(
                'absolute top-1/2 flex h-5 min-w-9 -translate-y-1/2 items-center truncate rounded-md bg-gradient-to-r px-2.5 text-[11px] font-black text-white',
                trackGradientClasses[item.color],
              )}
              style={{ left: `${item.offsetPercent}%`, width: `${item.widthPercent}%` }}
            >
              {item.label}
            </span>
          </div>
        </div>
      ))}
    </Card>
  );
}
