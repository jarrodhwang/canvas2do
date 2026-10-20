import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

interface DraftTitleInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onBlur' | 'value' | 'defaultValue'> {
  onCommit: (value: string) => void;
  onDone?: () => void;
  value: string;
}

// Keeps keystrokes in local state so typing never re-renders the surrounding
// dashboard/calendar tree; the value is committed once on blur, Enter, or unmount.
export function DraftTitleInput({ onCommit, onDone, onKeyDown, value, ...props }: DraftTitleInputProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const originalRef = useRef(value);
  const commitRef = useRef(onCommit);
  const doneRef = useRef(onDone);
  const settledRef = useRef(false);

  useEffect(() => {
    commitRef.current = onCommit;
    doneRef.current = onDone;
  });

  const settle = (next: string) => {
    if (settledRef.current) {
      return;
    }

    settledRef.current = true;
    if (next !== originalRef.current) {
      commitRef.current(next);
    }
    doneRef.current?.();
  };

  useEffect(() => () => {
    if (!settledRef.current && draftRef.current !== originalRef.current) {
      settledRef.current = true;
      commitRef.current(draftRef.current);
    }
  }, []);

  return (
    <input
      {...props}
      onBlur={() => settle(draftRef.current)}
      onChange={(event) => {
        draftRef.current = event.target.value;
        setDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === 'Escape') {
          draftRef.current = originalRef.current;
          setDraft(originalRef.current);
          event.currentTarget.blur();
        } else if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      value={draft}
    />
  );
}
