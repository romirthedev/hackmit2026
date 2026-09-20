'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages, jsx-a11y/media-has-caption -- originals are authenticated media; transcripts appear beside audio */
import { useEffect, useRef, useState } from 'react';
import {
  Aperture,
  ArrowUpRight,
  LogOut,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import { api, AUTH_REQUIRED_EVENT, type Recording } from '@/lib/api';
import Login from '@/components/login';
import '@/app/dashboard.css';
import '@/app/journal.css';
import { useRewind } from './use-rewind';
import { AskCard } from './ask-card';
import { DayJournal, WorkspaceLinks } from './day-journal';
import {
  ConnectionsCard,
  NoteCard,
  PeopleCard,
  TodayCard,
  recordedWhen,
} from './rose-cards';
import {
  DataCard,
  DeviceCard,
  LatestCard,
  OverviewCard,
  ProcessingCard,
  QuestionsCard,
  WatchCard,
} from './care-cards';
import { ago } from './primitives';

type Mode = 'wearer' | 'care';
type Filter = 'all' | 'memory' | 'watch' | 'device';
const FILTERS: [Filter, string][] = [
  ['all', 'Overview'],
  ['memory', 'Memory'],
  ['watch', 'Reminders'],
  ['device', 'Devices'],
];

export function Dashboard() {
  const rw = useRewind();
  const [mode, setMode] = useState<Mode>('wearer');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Recording | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [date, setDate] = useState('');
  const askRef = useRef<HTMLDivElement>(null);
  const sourceEpoch = useRef(0);
  const sourceRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- Read the explicit browser view preference after hydration.
    if (window.location.hash === '#care') setMode('care');
    const tick = () => {
      setDate(
        new Date().toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
      );
    };
    tick();
    const timer = setInterval(tick, 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle(
      'rw-light',
      rw.connection !== 'signed-out',
    );
    return () => document.documentElement.classList.remove('rw-light');
  }, [rw.connection]);
  useEffect(() => {
    const close = () => {
      sourceEpoch.current += 1;
      sourceRequest.current?.abort();
      setOpen(null);
      setSourceError('');
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, close);
    window.addEventListener('keydown', key);
    return () => {
      sourceEpoch.current += 1;
      sourceRequest.current?.abort();
      window.removeEventListener(AUTH_REQUIRED_EVENT, close);
      window.removeEventListener('keydown', key);
    };
  }, []);
  async function openDocument(id: string) {
    const current = ++sourceEpoch.current;
    sourceRequest.current?.abort();
    const controller = new AbortController();
    sourceRequest.current = controller;
    setSourceError('');
    try {
      const source = await api<Recording>(
        '/context/documents/' + encodeURIComponent(id),
        {
          signal: controller.signal,
        },
      );
      if (current === sourceEpoch.current && !controller.signal.aborted)
        setOpen(source);
    } catch (problem) {
      if (current === sourceEpoch.current && !controller.signal.aborted)
        setSourceError(
          problem instanceof Error ? problem.message : String(problem),
        );
    }
  }
  function openSource(record: Recording) {
    sourceEpoch.current += 1;
    sourceRequest.current?.abort();
    setSourceError('');
    if (record.kind === 'context') void openDocument(record.id);
    else setOpen(record);
  }
  function switchMode(next: Mode) {
    setMode(next);
    history.replaceState(
      null,
      '',
      window.location.pathname +
        window.location.search +
        (next === 'care' ? '#care' : ''),
    );
  }
  const status = rw.status,
    zone = status?.timezone,
    disabled = rw.connection !== 'live';
  const show = (category: Filter) => filter === 'all' || filter === category;

  if (rw.connection === 'signed-out')
    return (
      <>
        {rw.error && (
          <div className="dashboard-auth-error" role="alert">
            {rw.error}
            <button type="button" onClick={() => void rw.logout()}>
              Retry sign out
            </button>
          </div>
        )}
        <Login />
      </>
    );

  return (
    <div className="rw dashboard">
      <header className="topbar">
        <a className="rw-brand" href="/" aria-label="Rewind home">
          <span className="journal-brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          rewind
        </a>
        <div className="top-right">
          <span className={`conn ${rw.connection}`}>
            <i />
            {rw.connection === 'live'
              ? 'Connected'
              : rw.connection === 'checking'
                ? 'Connecting'
                : 'Connection interrupted'}
          </span>
          <a className="dashboard-workspace" href="/workspace">
            Workspace <ArrowUpRight />
          </a>
          <div className="seg" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'wearer'}
              className={`seg-btn ${mode === 'wearer' ? 'is-active' : ''}`}
              onClick={() => switchMode('wearer')}
            >
              My day
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'care'}
              className={`seg-btn ${mode === 'care' ? 'is-active' : ''}`}
              onClick={() => switchMode('care')}
            >
              Caretaker
            </button>
          </div>
          <button
            className="tbtn"
            type="button"
            aria-label="Sign out"
            onClick={() => {
              sourceEpoch.current += 1;
              sourceRequest.current?.abort();
              setOpen(null);
              void rw.logout();
            }}
          >
            <LogOut />
          </button>
        </div>
      </header>
      <main className={`page mode-${mode}`}>
        {(rw.error || sourceError) && (
          <div className="rw-banner" role="alert">
            <span>
              {sourceError || rw.error}
              {rw.connection === 'offline' && rw.lastSync
                ? ` Showing previously loaded data from ${ago(rw.now - rw.lastSync)}.`
                : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                setSourceError('');
                void rw.reload();
              }}
              aria-label="Retry connection"
            >
              <RefreshCw />
            </button>
          </div>
        )}
        <div className={`greeting ${mode === 'care' ? 'care' : ''}`}>
          <div>
            <p className="journal-date">{date || 'Your personal workspace'}</p>
            <h1>{mode === 'care' ? 'Shared overview' : 'Your day'}</h1>
          </div>
          <a className="journal-record-link" href="/phone">
            <Smartphone /> Open recorder <ArrowUpRight />
          </a>
        </div>
        {status && status.analysis_ready === false && (
          <div className="journal-service-note" aria-live="polite">
            <span />
            <p>
              Analysis is offline. Your saved recordings are still available.
            </p>
            <a href="/workspace#usage">
              View status <ArrowUpRight />
            </a>
          </div>
        )}
        {mode === 'care' && (
          <div className="chipset filter" role="tablist" aria-label="Section">
            {FILTERS.map(([key, name]) => (
              <button
                type="button"
                role="tab"
                key={key}
                aria-selected={filter === key}
                className={`chip ${filter === key ? 'is-active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {!status ? (
          <div className="dashboard-loading" aria-live="polite">
            <Aperture />
            <h2>
              {rw.connection === 'checking'
                ? 'Opening your workspace…'
                : 'Your workspace is unavailable.'}
            </h2>
            <p>
              {rw.connection === 'checking'
                ? 'Loading your actual saved moments.'
                : 'Reconnect to see saved recordings and connected sources.'}
            </p>
            {rw.connection === 'offline' && (
              <button
                type="button"
                className="btn"
                onClick={() => void rw.reload()}
              >
                Try again
              </button>
            )}
          </div>
        ) : mode === 'wearer' ? (
          <div className="journal-layout" key="wearer">
            <DayJournal
              records={rw.records}
              status={status}
              onOpen={openSource}
            />
            <aside className="journal-aside" aria-label="Recall and reminders">
              <AskCard
                index={1}
                ask={rw.ask}
                answers={rw.answers}
                onOpen={openSource}
                disabled={disabled}
              />
              <TodayCard
                index={2}
                graph={rw.graph}
                reminders={rw.reminders}
                onSeen={rw.reminderSeen}
                onDocument={(id) => void openDocument(id)}
                disabled={disabled}
              />
              <QuestionsCard
                index={8}
                answers={rw.answers}
                zone={zone}
                onOpen={openSource}
              />
            </aside>
          </div>
        ) : (
          <div className="grid" key={`care-${filter}`}>
            {show('watch') && (
              <OverviewCard
                index={0}
                status={status}
                latest={rw.records[0]}
                alerts={rw.alerts}
                onAsk={() =>
                  askRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                  })
                }
              />
            )}
            {(show('memory') || filter === 'watch') && (
              <div ref={askRef} className="cell-wrap">
                <AskCard
                  index={1}
                  ask={rw.ask}
                  answers={rw.answers}
                  onOpen={openSource}
                  disabled={disabled}
                  label="Ask about the day"
                />
              </div>
            )}
            {show('watch') && (
              <WatchCard
                index={2}
                rules={rw.rules}
                alerts={rw.alerts}
                zone={zone}
                onAdd={rw.addRule}
                onRemove={rw.removeRule}
                onSeen={rw.markSeen}
                disabled={disabled}
              />
            )}
            {show('watch') && (
              <TodayCard
                index={3}
                graph={rw.graph}
                reminders={rw.reminders}
                onSeen={rw.reminderSeen}
                onDocument={(id) => void openDocument(id)}
                disabled={disabled}
              />
            )}
            {show('memory') && (
              <LatestCard
                index={4}
                records={rw.records}
                zone={zone}
                onOpen={openSource}
              />
            )}
            {filter === 'memory' && (
              <QuestionsCard
                index={5}
                answers={rw.answers}
                zone={zone}
                onOpen={openSource}
              />
            )}
            {filter === 'device' && (
              <DeviceCard
                index={6}
                status={status}
                online={rw.online}
                now={rw.now}
                onPause={rw.setPaused}
                disabled={disabled}
              />
            )}
            {filter === 'memory' && <PeopleCard index={7} people={rw.people} />}
            {filter === 'memory' && (
              <NoteCard
                index={8}
                graph={rw.graph}
                onDocument={(id) => void openDocument(id)}
              />
            )}
            {filter === 'device' && (
              <ProcessingCard
                index={9}
                status={status}
                onRetry={rw.retryFailed}
                disabled={disabled}
              />
            )}
            {filter === 'device' && <DataCard index={10} status={status} />}
            {filter === 'memory' && <ConnectionsCard index={11} graph={rw.graph} />}
          </div>
        )}
        {status && <WorkspaceLinks peopleCount={rw.people.length} />}
        <footer className="journal-footer">
          <span>rewind</span>
          <p>Personal workspace</p>
          <a href="/workspace#usage">
            Storage &amp; usage <ArrowUpRight />
          </a>
        </footer>
      </main>
      {open && (
        <dialog className="lightbox" open aria-label="Original source">
          <button
            type="button"
            className="lb-close"
            onClick={() => setOpen(null)}
            aria-label="Close source"
          >
            <X />
          </button>
          {open.kind === 'context' ? (
            <div className="lb-document">
              <h2>{open.title || 'Connected source'}</h2>
              <p>{open.context_kind} · Notch</p>
              <pre>{open.text}</pre>
            </div>
          ) : open.media_url ? (
            open.kind === 'frame' ? (
              <img src={open.media_url} alt="Original recorded source" />
            ) : (
              <div className="lb-audio">
                <audio controls src={open.media_url} />
                <p>{open.transcript || 'No transcript available.'}</p>
              </div>
            )
          ) : (
            <div className="lb-document">
              <h2>Original unavailable</h2>
              <p>This source cannot currently be opened.</p>
            </div>
          )}
          <p>
            {recordedWhen(open, zone)}
            {open.kind !== 'context' && open.summary
              ? ` · Automatic description: ${open.summary}`
              : ''}
          </p>
          {open.original_recording?.original_url && (
            <a
              className="btn"
              href={open.original_recording.original_url}
              target="_blank"
              rel="noreferrer"
            >
              Open retained original video
            </a>
          )}
        </dialog>
      )}
    </div>
  );
}
