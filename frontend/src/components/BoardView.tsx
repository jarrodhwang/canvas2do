import type { BoardItem } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import type { BoardColumnConfig } from '../modes/types';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';

interface BoardViewProps {
  columns: BoardColumnConfig[];
  items: BoardItem[];
  onSelectItem: () => void;
}

export function BoardView({ columns, items, onSelectItem }: BoardViewProps) {
  const { translateBoardColumn } = useLanguage();

  return (
    <Card className="overflow-hidden rounded-xl bg-card shadow-none">
      <div className="grid min-h-[440px] grid-cols-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        {columns.map((column) => {
          const columnItems = items.filter((item) => item.columnId === column.id);

          return (
            <section className="border-r bg-muted/25 p-3 last:border-r-0 max-sm:border-r-0 max-sm:border-b" key={column.id}>
              <h3 className="mb-3 flex items-center justify-between gap-2 text-sm font-black">
                <span>{translateBoardColumn(column.id, column.label)}</span>
                <EventPill color="gray" label={`${columnItems.length}`} compact />
              </h3>
              {columnItems.map((item) => (
                <Button
                  className="mb-2 grid h-auto w-full gap-2 rounded-lg border bg-card p-3 text-left shadow-none hover:bg-muted"
                  key={item.id}
                  onClick={onSelectItem}
                  type="button"
                  variant="ghost"
                >
                  <span className="text-sm font-black text-foreground">{item.title}</span>
                  <span className="flex flex-wrap gap-1.5">
                    <EventPill color={item.color} label={item.type} compact />
                    <EventPill color="gray" label={item.checklistProgress} compact />
                  </span>
                </Button>
              ))}
            </section>
          );
        })}
      </div>
    </Card>
  );
}
