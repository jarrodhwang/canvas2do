import { CheckCircle2, GraduationCap, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { workspaceApi, type CanvasIntegrationStatus } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

interface CanvasConnectionDialogProps {
  open: boolean;
  onConnected: () => void;
  onOpenChange: (open: boolean) => void;
}

export function CanvasConnectionDialog({
  open,
  onConnected,
  onOpenChange,
}: CanvasConnectionDialogProps) {
  const { dictionary } = useLanguage();
  const [status, setStatus] = useState<CanvasIntegrationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let isMounted = true;

    setIsLoading(true);
    workspaceApi
      .getCanvasIntegration()
      .then((nextStatus) => {
        if (!isMounted) {
          return;
        }

        setStatus(nextStatus);

        if (nextStatus.connected) {
          onConnected();
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [onConnected, open]);

  const isConnected = status?.connected ?? false;
  const isConfigured = status?.configured ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <GraduationCap aria-hidden="true" className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black">{dictionary.canvasRequiredTitle}</DialogTitle>
              <DialogDescription className="mt-1">
                {dictionary.canvasRequiredDescription}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-black">{dictionary.canvasLms}</span>
            </div>
            <Badge variant={isConnected ? 'default' : 'outline'}>
              {isLoading ? dictionary.checkingCanvasConfig : isConnected ? dictionary.canvasConnected : dictionary.canvasNotConnected}
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {isConfigured ? dictionary.canvasTokenDescription : dictionary.canvasTokenNotConfigured}
          </p>
          {status?.userName ? (
            <p className="text-xs font-bold text-muted-foreground">
              {dictionary.canvasConnectedAs} {status.userName}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {dictionary.cancel}
          </Button>
          <Button
            className="font-black"
            disabled
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              {isLoading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {isConnected ? <CheckCircle2 aria-hidden="true" className="size-4" /> : null}
              {!isLoading && !isConnected ? <KeyRound aria-hidden="true" className="size-4" /> : null}
              {isLoading ? dictionary.checkingCanvasConfig : isConnected ? dictionary.canvasConnected : dictionary.canvasTokenRequired}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
