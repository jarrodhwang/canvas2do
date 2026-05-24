import { ExternalLink } from 'lucide-react';
import type { LinkItem } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/button';

interface LinkListProps {
  links: LinkItem[];
}

export function LinkList({ links }: LinkListProps) {
  const { dictionary } = useLanguage();

  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">{dictionary.noLinks}</p>;
  }

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <Button
          asChild
          className="h-auto w-full justify-between rounded-lg border bg-muted/35 p-3 text-left text-foreground hover:bg-muted"
          key={link.id}
          variant="ghost"
        >
          <a href={link.url}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <ExternalLink aria-hidden="true" size={15} />
              <span className="truncate">{link.label}</span>
            </span>
            <strong className="shrink-0 text-[10px] uppercase text-muted-foreground">
              {link.provider}
            </strong>
          </a>
        </Button>
      ))}
    </div>
  );
}
