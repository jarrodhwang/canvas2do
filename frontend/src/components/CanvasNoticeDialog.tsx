import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

export function CanvasNoticeDialog({ message, open, onClose }: { message: string; open: boolean; onClose: () => void }) {
  const { dictionary, language } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{dictionary.academyGradesCanvas}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button className="h-11" type="button">{language === 'ko' ? '닫기' : 'Close'}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
