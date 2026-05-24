import type { ReactNode } from 'react';
import { useLanguage } from '../context/LanguageContext';
import type { AddItemFieldConfig, WorkspaceModeConfig } from '../modes/types';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';

interface AddItemModalProps {
  mode: WorkspaceModeConfig;
  open: boolean;
  onClose: () => void;
}

function FieldShell({
  children,
  field,
  label,
}: {
  children: ReactNode;
  field: AddItemFieldConfig;
  label: string;
}) {
  return (
    <div className={field.fullWidth ? 'space-y-2 md:col-span-2' : 'space-y-2'}>
      <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={field.id}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function renderField(
  field: AddItemFieldConfig,
  translateFieldLabel: (fieldId: string, fallback: string) => string,
) {
  const label = translateFieldLabel(field.id, field.label);
  const placeholder = field.placeholder ?? label;

  if (field.type === 'textarea') {
    return (
      <FieldShell field={field} key={field.id} label={label}>
        <Textarea
          className="min-h-24 rounded-lg bg-muted/35"
          id={field.id}
          placeholder={placeholder}
          required={field.required}
        />
      </FieldShell>
    );
  }

  if (field.type === 'select' || field.type === 'priority') {
    const options = field.options ?? [];

    return (
      <FieldShell field={field} key={field.id} label={label}>
        <Select defaultValue={options[0]}>
          <SelectTrigger className="h-10 w-full rounded-lg bg-muted/35" id={field.id}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>
    );
  }

  const inputType = field.type === 'url' ? 'url' : field.type === 'date' ? 'date' : 'text';

  return (
    <FieldShell field={field} key={field.id} label={label}>
      <Input
        className="h-10 rounded-lg bg-muted/35"
        id={field.id}
        placeholder={placeholder}
        required={field.required}
        type={inputType}
      />
    </FieldShell>
  );
}

export function AddItemModal({ mode, open, onClose }: AddItemModalProps) {
  const { dictionary, translateFieldLabel, translateModeName } = useLanguage();
  const modeName = translateModeName(mode.id, mode.displayName);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-auto rounded-xl p-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">
            {dictionary.addItemPrefix
              ? `${dictionary.addItemPrefix} ${modeName} ${dictionary.addItemSuffix}`
              : `${modeName} ${dictionary.addItemSuffix}`}
          </DialogTitle>
          <DialogDescription>
            {dictionary.addItemDescription}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onClose();
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {mode.addItemFields.map((field) => renderField(field, translateFieldLabel))}
          </div>
          <DialogFooter className="mt-2">
            <Button onClick={onClose} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              type="submit"
            >
              {dictionary.saveMockItem}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
