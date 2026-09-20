'use client';
import { useRef, useState, type ReactNode } from 'react';
import { api, type Status } from '@/lib/api';
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
  demo,
}: {
  children?: ReactNode;
  className?: string;
  beforeClear?: () => Promise<unknown> | void;
  demo?: Status['demo'];
}) {
  const [open, setOpen] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const demoMode = demo?.enabled === true;
  const protectedWalkthrough = demo?.ready === true && demo.protected_media_count > 0;
  const protectionUnavailable = demoMode && !protectedWalkthrough;
  async function clear() {
    if (busy || protectionUnavailable) return;
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
        aria-label={demoMode ? 'Reset live demo memories' : 'Clear all memory'}
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
        <AlertDialogTitle>
          {demoMode ? 'Reset live demo memories?' : 'Clear all memory?'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {demoMode
            ? 'Clear the letter, medical bill, new recordings and conversation history. The saved dorm walkthrough and its answers stay ready for the next demo.'
            : 'This permanently clears saved recordings, scans, answers, people and conversation history from Rewind. Connected memory is cleared and sync is turned off. Original mail, calendars and notes in connected apps stay there.'}
        </AlertDialogDescription>
        {protectionUnavailable ? (
          <p className="memory-reset-error" role="alert">
            Walkthrough protection is not ready. Reset is unavailable until it is restored.
          </p>
        ) : (
          <p>
            {demoMode
              ? 'Stop recording on other devices first. New demo memories cannot be recovered after reset.'
              : 'Stop recording on other devices first. This cannot be undone.'}
          </p>
        )}
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
            disabled={busy || protectionUnavailable}
            onClick={() => void clear()}
          >
            {busy ? 'Clearing…' : demoMode ? 'Reset demo' : 'OK'}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
