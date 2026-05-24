import type { DetailItem } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

interface ChecklistProps {
  items: DetailItem['checklist'];
}

export function Checklist({ items }: ChecklistProps) {
  const { dictionary } = useLanguage();

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{dictionary.noChecklist}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Label className="flex items-start gap-2 text-sm font-semibold text-muted-foreground" key={item.id}>
          <Checkbox className="mt-0.5" defaultChecked={item.done} />
          <span>{item.label}</span>
        </Label>
      ))}
    </div>
  );
}
