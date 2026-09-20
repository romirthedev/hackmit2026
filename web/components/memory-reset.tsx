'use client';
import { useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

export function MemoryReset({
  children = 'Memory',
  className = '',
  beforeClear,
}: {
  children?: ReactNode;
  className?: string;
  beforeClear?: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function clear() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await beforeClear?.();
      await api('/memory', {
        method: 'DELETE',
        body: JSON.stringify({ confirm: true }),
      });
      window.location.reload();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setBusy(false);
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <button
        type="button"
        className={`memory-link ${className}`}
        aria-label="Clear all memory"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        {children}
      </button>
      <AlertDialogContent
        className="memory-confirm"
        initialFocus={cancelButton}
      >
        <AlertDialogTitle>Clear all memory?</AlertDialogTitle>
        <AlertDialogDescription>
          This permanently clears saved recordings, scans, answers, people and
          conversation history from Rewind. Connected memory is cleared and sync
          is turned off. Original mail, calendars and notes in connected apps
          stay there.
        </AlertDialogDescription>
        <p>Stop recording on other devices first. This cannot be undone.</p>
        {error && (
          <p className="memory-reset-error" role="alert">
            {error}
          </p>
        )}
        <div className="memory-confirm-actions">
          <AlertDialogCancel ref={cancelButton} disabled={busy}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            className="memory-confirm-ok"
            disabled={busy}
            onClick={() => void clear()}
          >
            {busy ? 'Clearing…' : 'OK'}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
