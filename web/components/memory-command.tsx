'use client';
import { CatalogButton } from '@/components/catalog';

import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Clock3,
  Bell,
  Box,
  Wifi,
  Upload,
  Search,
  FileAudio,
  CornerDownLeft,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { api, clock, type Recording } from '@/lib/api';

const actions = [
  { id: 'memory', label: 'Your memory', icon: Clock3 },
  { id: 'monitor', label: 'Watch for me', icon: Bell },
  { id: 'scene', label: '3D scene', icon: Box },
  { id: 'system', label: 'Device & storage', icon: Wifi },
  { id: 'import', label: 'Import a recording', icon: Upload },
];

export function MemoryCommand({
  records,
  timezone,
  busy,
  onNavigate,
  onSelect,
}: {
  records: Recording[];
  timezone?: string;
  busy: boolean;
  onNavigate: (destination: string) => void;
  onSelect: (recording: Recording) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{
    query: string;
    records: Recording[];
    error: string;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = query.trim();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Leave nested recording/deletion dialogs in control of their focus.
        if (
          !open &&
          document.querySelector('[role="dialog"], [role="alertdialog"]')
        )
          return;
        e.preventDefault();
        setOpen(!open);
        if (open) {
          setQuery('');
          setState(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !term) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const found = await api<Recording[]>(
          '/events?' + new URLSearchParams({ q: term, limit: '8' }),
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setState({ query: term, records: found, error: '' });
      } catch (e) {
        if (!controller.signal.aborted)
          setState({
            query: term,
            records: [],
            error: String(e).replace(/^Error: /, ''),
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, term]);

  const loading = !!term && state?.query !== term;
  const found = term
    ? state?.query === term
      ? state.records
      : []
    : records.slice(0, 5);
  const matchingActions = actions.filter((a) =>
    a.label.toLowerCase().includes(term.toLowerCase()),
  );
  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value) {
      setQuery('');
      setState(null);
    }
  }
  return (
    <>
      <CatalogButton
        ref={trigger}
        type="button"
        className="command-trigger"
        onClick={() => changeOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search size={17} />
        <span>Quick search</span>
        <kbd>⌘ K</kbd>
      </CatalogButton>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          className="memory-command"
          initialFocus={input}
          finalFocus={trigger}
        >
          <DialogTitle className="sr-only">Search your workspace</DialogTitle>
          <DialogDescription className="sr-only">
            Search all recordings or jump to a workspace section. Use arrow keys
            and Enter to select.
          </DialogDescription>
          <Command shouldFilter={false} label="Workspace search">
            <CommandInput
              ref={input}
              value={query}
              onValueChange={(value) => {
                if (value.trim() !== term) setState(null);
                setQuery(value);
              }}
              placeholder="Find a memory or jump to…"
              maxLength={200}
            />
            <CommandList>
              {matchingActions.length > 0 && (
                <CommandGroup heading="Quick actions">
                  {matchingActions.map(({ id, label, icon: Icon }) => (
                    <CommandItem
                      key={id}
                      value={'action-' + id}
                      disabled={id === 'import' && busy}
                      onSelect={() => {
                        changeOpen(false);
                        onNavigate(id);
                      }}
                    >
                      <span className="command-icon">
                        <Icon size={18} />
                      </span>
                      <span>{label}</span>
                      <CornerDownLeft className="command-enter" size={14} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandGroup
                heading={
                  term ? 'Matching memories · all time' : 'Recent memories'
                }
              >
                {loading && (
                  <output className="command-message">
                    Searching your recordings…
                  </output>
                )}
                {!loading && state?.query === term && state.error && (
                  <p className="command-message error-text" role="alert">
                    {state.error}
                  </p>
                )}
                {!loading &&
                  found.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.id}
                      onSelect={() => {
                        changeOpen(false);
                        onSelect(r);
                      }}
                    >
                      <span className="command-icon">
                        {r.kind === 'frame' ? (
                          <Camera size={18} />
                        ) : (
                          <FileAudio size={18} />
                        )}
                      </span>
                      <span className="command-memory">
                        <strong>
                          {r.summary ||
                            r.transcript ||
                            (r.kind === 'frame'
                              ? 'Camera recording'
                              : 'Audio recording')}
                        </strong>
                        <small>
                          {new Date(r.captured_at * 1000).toLocaleDateString(
                            [],
                            {
                              month: 'short',
                              day: 'numeric',
                              timeZone: timezone,
                            },
                          )}{' '}
                          · {clock(r.captured_at, timezone)}
                        </small>
                      </span>
                    </CommandItem>
                  ))}
                {!loading && !found.length && !state?.error && (
                  <p className="command-message">
                    {term
                      ? 'No memories found. Try an object, place, or phrase.'
                      : 'Your recordings will appear here.'}
                  </p>
                )}
              </CommandGroup>
            </CommandList>
            <div className="command-footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> to move
              </span>
              <span>
                <kbd>↵</kbd> to open
              </span>
              <span>
                <kbd>esc</kbd> to close
              </span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
