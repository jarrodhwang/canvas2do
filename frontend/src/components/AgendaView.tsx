import type { AgendaItem } from '../data/mockWorkspaceData';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';

interface AgendaViewProps {
  items: AgendaItem[];
  onSelectItem: () => void;
}

export function AgendaView({ items, onSelectItem }: AgendaViewProps) {
  return (
    <Card className="min-h-[440px] rounded-xl bg-card p-4 shadow-none">
      {items.map((item) => (
        <Button
          className="mb-2 grid h-auto w-full grid-cols-[86px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-muted/35 p-3 text-left shadow-none hover:bg-muted max-sm:grid-cols-[70px_minmax(0,1fr)]"
          key={item.id}
          onClick={onSelectItem}
          type="button"
          variant="ghost"
        >
          <div className="text-base font-black text-primary">{item.time}</div>
          <div className="min-w-0">
            <div className="truncate font-black text-foreground">{item.title}</div>
            <div className="truncate text-xs font-semibold text-muted-foreground">
              {item.subtitle}
            </div>
          </div>
          <div className="max-sm:col-start-2 max-sm:justify-self-start">
            <EventPill color={item.color} label={item.type} />
          </div>
        </Button>
      ))}
    </Card>
  );
}
