import type { DetailItem } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import type { WorkspaceModeConfig } from '../modes/types';
import { Checklist } from './Checklist';
import { LinkList } from './LinkList';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Separator } from './ui/separator';

interface DetailPanelProps {
  mode: WorkspaceModeConfig;
  item: DetailItem;
}

export function DetailPanel({ mode, item }: DetailPanelProps) {
  const { dictionary, translateFieldLabel, translateModeName } = useLanguage();

  return (
    <Card className="sticky top-[92px] min-h-[calc(100vh-110px)] w-full min-w-0 self-start overflow-hidden rounded-xl bg-card p-4 shadow-none xl:static xl:h-full xl:min-h-0 xl:self-stretch xl:overflow-y-auto max-xl:static max-xl:col-span-2 max-xl:min-h-0">
      <div className="mb-4 rounded-xl border bg-muted/45 p-4">
        <Badge className="mb-3 bg-primary text-primary-foreground hover:bg-primary" variant="secondary">
          {translateModeName(mode.id, mode.displayName)}
        </Badge>
        <h2 className="text-xl font-black leading-tight">{item.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
      </div>

      <CardContent className="space-y-4 px-0 pb-0">
      <section>
        <h3 className="mb-2 text-[11px] font-black uppercase text-muted-foreground">{dictionary.mainInfo}</h3>
        <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          {mode.detailFields.map((field) => (
            <div className="rounded-lg border bg-muted/35 p-3" key={field.id}>
              <span className="block text-[11px] font-black uppercase text-muted-foreground">
                {translateFieldLabel(field.id, field.label)}
              </span>
              <strong className="mt-1 block text-sm">{item.fields[field.id] ?? dictionary.notSet}</strong>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      <section>
        <h3 className="mb-2 text-[11px] font-black uppercase text-muted-foreground">{dictionary.checklist}</h3>
        <Checklist items={item.checklist} />
      </section>

      <Separator />

      <section>
        <h3 className="mb-2 text-[11px] font-black uppercase text-muted-foreground">{dictionary.links}</h3>
        <LinkList links={item.links} />
      </section>

      <Separator />

      <section>
        <h3 className="mb-2 text-[11px] font-black uppercase text-muted-foreground">{dictionary.notes}</h3>
        <div className="rounded-lg border bg-muted/35 p-3 text-sm leading-relaxed text-muted-foreground">
          {item.notes}
        </div>
      </section>
      </CardContent>
    </Card>
  );
}
