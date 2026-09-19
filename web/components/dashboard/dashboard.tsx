'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages, jsx-a11y/media-has-caption -- originals are served straight from the local server; transcripts sit beside audio */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Aperture, LogIn, X } from 'lucide-react';
import type { Recording } from '@/lib/api';
import '@/app/dashboard.css';
import { useRewind } from './use-rewind';
import { AskCard } from './ask-card';
import { hm } from './primitives';
import {
  ActivityCard,
  ClipCard,
  HelpCard,
  MedsCard,
  MemoryLogCard,
  MomentsCard,
  NoteCard,
  OnTheWayCard,
  PeopleCard,
  TodayCard,
  WeatherCard,
  WhereCard,
} from './rose-cards';
import {
  AdherenceCard,
  CareTeamCard,
  DataCard,
  DeviceCard,
  LatestCard,
  NotesCard,
  ProcessingCard,
  QuestionsCard,
  RoseHeroCard,
  TrendsCard,
  WatchCard,
} from './care-cards';

type Mode = 'rose' | 'care';
type Filter = 'all' | 'health' | 'memory' | 'watch' | 'device';
const FILTERS: [Filter, string][] = [
  ['all', 'Overview'],
  ['health', 'Health'],
  ['memory', 'Memory'],
  ['watch', 'Watch'],
  ['device', 'Device'],
];

export function Dashboard() {
  const rw = useRewind();
  const [mode, setMode] = useState<Mode>('rose');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Recording | null>(null);
  const [clock, setClock] = useState('');
  const [mounted, setMounted] = useState(false);
  const gridKey = `${mode}-${filter}`;
  useEffect(() => {
    // Everything below depends on the browser clock and locale, so it only
    // renders after mount to keep server and client markup identical.
    // oxlint-disable-next-line react/react-compiler -- one-time mount flag
    setMounted(true);
    if (window.location.hash === '#care') setMode('care');
    const f = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      );
    f();
    const t = setInterval(f, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('rw-light', true);
    return () => document.documentElement.classList.remove('rw-light');
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  const askRef = useRef<HTMLDivElement>(null);
  const switchMode = (m: Mode) => {
    setMode(m);
    history.replaceState(
      null,
      '',
      m === 'care' ? '#care' : window.location.pathname,
    );
  };

  const hour = new Date().getHours();
  const greet =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const zone = rw.status.timezone;
  const since = rw.records.length
    ? hm(rw.records[rw.records.length - 1].captured_at, zone)
    : null;

  // Which caretaker cards belong to which filter. Cards can live in several.
  const care: [Filter[], ReactNode][] = useMemo(
    () => [
      [
        ['all', 'health', 'watch'],
        <RoseHeroCard
          key="hero"
          index={0}
          status={rw.status}
          online={rw.online}
          now={rw.now}
          records={rw.records}
          alerts={rw.alerts}
          onAsk={() =>
            askRef.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            })
          }
        />,
      ],
      [
        ['all', 'memory', 'watch'],
        <div key="ask" ref={askRef} className="cell-wrap">
          <AskCard
            index={1}
            ask={rw.ask}
            label="Ask about Rose"
            title="Ask"
            placeholder="What did Rose do this morning?"
          />
        </div>,
      ],
      [
        ['all', 'watch'],
        <WatchCard
          key="watch"
          index={2}
          rules={rw.rules}
          alerts={rw.alerts}
          zone={zone}
          onAdd={rw.addRule}
          onRemove={rw.removeRule}
          onSeen={rw.markSeen}
        />,
      ],
      [['all', 'health'], <AdherenceCard key="adh" index={3} />],
      [
        ['all', 'memory'],
        <LatestCard
          key="latest"
          index={4}
          records={rw.records}
          zone={zone}
          onOpen={setOpen}
        />,
      ],
      [
        ['all', 'memory'],
        <QuestionsCard key="q" index={5} answers={rw.answers} zone={zone} />,
      ],
      [
        ['all', 'device'],
        <DeviceCard
          key="dev"
          index={6}
          status={rw.status}
          online={rw.online}
          now={rw.now}
          onPause={rw.setPaused}
        />,
      ],
      [['health'], <TrendsCard key="trends" index={7} />],
      [['all', 'health'], <NotesCard key="notes" index={8} />],
      [
        ['memory'],
        <MemoryLogCard key="log" index={9} records={rw.records} zone={zone} />,
      ],
      [['memory'], <WhereCard key="where" index={10} />],
      [
        ['all', 'device'],
        <ProcessingCard
          key="proc"
          index={11}
          status={rw.status}
          onRetry={rw.retryFailed}
        />,
      ],
      [['health', 'all'], <TodayCard key="today" index={12} />],
      [['health'], <CareTeamCard key="team" index={13} />],
      [
        ['device', 'all'],
        <DataCard key="data" index={14} status={rw.status} />,
      ],
    ],
    [rw, zone],
  );

  return (
    <div className="rw">
      <header className="topbar">
        <a className="rw-brand" href="/" aria-label="Rewind home">
          <span className="rw-brand-mark">
            <Aperture />
          </span>
          rewind<span className="rw-brand-period">.</span>
          <span className="rw-brand-time">{clock}</span>
        </a>
        <div className="top-right">
          {rw.connection !== 'live' && (
            <a
              className={`conn ${rw.connection}`}
              href="/workspace"
              title={
                rw.connection === 'signed-out'
                  ? 'Sign in to the local server to see live data'
                  : 'Local server unreachable, showing demo data'
              }
            >
              <i />
              {rw.connection === 'checking' ? (
                'Connecting'
              ) : rw.connection === 'signed-out' ? (
                <>
                  <LogIn />
                  Sign in for live data
                </>
              ) : (
                'Demo data'
              )}
            </a>
          )}
          <div className="seg" role="tablist" aria-label="View">
            <span
              className="seg-thumb"
              style={{ transform: `translateX(${mode === 'rose' ? 0 : 100}%)` }}
              aria-hidden="true"
            />
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'rose'}
              className={`seg-btn ${mode === 'rose' ? 'is-active' : ''}`}
              onClick={() => switchMode('rose')}
            >
              Rose
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
        </div>
      </header>

      <main className={`page mode-${mode}`}>
        {rw.error && (
          <div className="rw-banner" role="alert">
            <span>{rw.error}</span>
            <button
              type="button"
              onClick={() => rw.reload()}
              aria-label="Dismiss"
            >
              <X />
            </button>
          </div>
        )}

        {!mounted ? null : mode === 'rose' ? (
          <div className="greeting">
            <h1>{greet}, Rose</h1>
            <p>
              {rw.online && !rw.status.paused
                ? `Your clip has been listening${since ? ` since ${since}` : ''}.`
                : 'Your clip is resting. Everything you saved is still here.'}
            </p>
          </div>
        ) : (
          <div className="greeting care">
            <div>
              <h1>Rose&rsquo;s day</h1>
              <p>
                {rw.status.analyzed.toLocaleString()} moments remembered ·{' '}
                {rw.alerts.filter((a) => !a.seen).length} new alerts ·{' '}
                {rw.online ? 'necklace connected' : 'necklace offline'}
              </p>
            </div>
            <div className="chipset filter" role="tablist" aria-label="Section">
              {FILTERS.map(([f, name]) => (
                <button
                  type="button"
                  role="tab"
                  key={f}
                  aria-selected={filter === f}
                  className={`chip ${filter === f ? 'is-active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!mounted ? null : mode === 'rose' ? (
          <div className="grid" key={gridKey}>
            <ClipCard
              index={0}
              status={rw.status}
              online={rw.online}
              onPause={rw.setPaused}
            />
            <AskCard index={1} ask={rw.ask} />
            <OnTheWayCard index={2} />
            <WhereCard index={3} />
            <TodayCard index={4} />
            <PeopleCard index={5} />
            <MemoryLogCard index={6} records={rw.records} zone={zone} />
            <NoteCard index={7} />
            <MomentsCard
              index={8}
              records={rw.records}
              zone={zone}
              onOpen={setOpen}
            />
            <MedsCard index={9} />
            <WeatherCard index={10} />
            <ActivityCard index={11} />
            <HelpCard index={12} />
          </div>
        ) : (
          <div className="grid" key={gridKey}>
            {care
              .filter(([tags]) => tags.includes(filter))
              .map(([, node]) => node)}
          </div>
        )}
      </main>

      {open && (
        <dialog className="lightbox" open aria-label="Recording">
          <button
            type="button"
            className="lb-close"
            onClick={() => setOpen(null)}
            aria-label="Close"
          />
          {open.kind === 'frame' ? (
            <img src={open.media_url} alt={open.summary || ''} />
          ) : (
            <div className="lb-audio">
              <audio controls src={open.media_url} />
              <p>{open.transcript}</p>
            </div>
          )}
          <p>
            {hm(open.captured_at, zone)}
            {open.summary ? ` · ${open.summary}` : ''}
          </p>
        </dialog>
      )}
    </div>
  );
}
