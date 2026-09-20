'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages, jsx-a11y/media-has-caption -- originals are served straight from the local server; transcripts sit beside audio */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Aperture, X } from 'lucide-react';
import {
  api,
  AUTH_REQUIRED_EVENT,
  type Recording,
  type ScanDocument,
} from '@/lib/api';
import Login from '@/components/login';
import { MemoryReset } from '@/components/memory-reset';
import { demoStatus } from './demo-data';
import '@/app/mail.css';
import {
  CalendarCard,
  LettersCard,
  BillSlip,
  PostcardBack,
  PostcardFront,
  isBill,
} from './mail-cards';
import '@/app/dashboard.css';
import { useRewind } from './use-rewind';
import { AskCard } from './ask-card';
import { Arrivals } from './arrivals';
import { hm } from './primitives';
import {
  ActivityCard,
  PhoneCard,
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
  const live = useRewind();
  const rw = { ...live, status: live.status ?? demoStatus };
  const [mode, setMode] = useState<Mode>('rose');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Recording | null>(null);
  const [openScan, setOpenScan] = useState<ScanDocument | null>(null);
  const [sourceError, setSourceError] = useState('');
  const sourceEpoch = useRef(0);
  const sourceRequest = useRef<AbortController | null>(null);
  const [arriving, setArriving] = useState<string | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  const pendingMail = new Set(
    rw.arrivals.filter((item) => item.id !== landedId).map((item) => item.id),
  );
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
    const close = () => {
      sourceEpoch.current += 1;
      sourceRequest.current?.abort();
      setOpen(null);
      setOpenScan(null);
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

  // Which caretaker cards belong to which filter. Cards can live in several.
  const care: [Filter[], ReactNode][] = [
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
          answers={rw.answers}
          onOpen={openSource}
          disabled={rw.connection !== 'live'}
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
        onOpen={openSource}
        arriving={arriving}
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
      <MemoryLogCard
        key="log"
        index={9}
        records={rw.records}
        zone={zone}
        now={rw.now}
      />,
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
    [['device', 'all'], <DataCard key="data" index={14} status={rw.status} />],
  ];

  if (rw.connection === 'signed-out') return <Login />;
  if (!live.status)
    return (
      <div className="rw">
        <main className="page">
          <h1>
            {rw.connection === 'checking'
              ? 'Opening your workspace…'
              : 'Your workspace is unavailable.'}
          </h1>
          <button type="button" onClick={() => void rw.reload()}>
            Try again
          </button>
        </main>
      </div>
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
          <MemoryReset />
          {rw.connection !== 'live' && (
            <span className={`conn ${rw.connection}`}>
              <i />
              {rw.connection === 'checking'
                ? 'Connecting'
                : 'Connection interrupted'}
            </span>
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
        {(rw.error || sourceError) && (
          <div className="rw-banner" role="alert">
            <span>{sourceError || rw.error}</span>
            <button
              type="button"
              onClick={() => {
                setSourceError('');
                void rw.reload();
              }}
              aria-label="Dismiss"
            >
              <X />
            </button>
          </div>
        )}

        {!mounted ? null : mode === 'rose' ? (
          <div className="greeting">
            <h1>{greet}, Rose</h1>
            <p>Your day, remembered. Record a moment from your iPhone.</p>
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
            <PhoneCard index={0} status={rw.status} now={rw.now} />
            <AskCard
              index={1}
              ask={rw.ask}
              answers={rw.answers}
              onOpen={openSource}
              disabled={rw.connection !== 'live'}
            />
            <OnTheWayCard index={2} />
            {live.status && (
              <section
                className="mail-widgets dashboard-mail"
                aria-label="Calendar and notes"
              >
                <CalendarCard
                  index={12}
                  scans={rw.scans}
                  pending={pendingMail}
                  landedId={landedId}
                  reminders={rw.reminders}
                  graph={rw.graph}
                  zone={zone}
                  arriving={arriving}
                  disabled={rw.connection !== 'live'}
                  onOpen={setOpenScan}
                  onDocument={(id) => void openDocument(id)}
                  onSeen={rw.reminderSeen}
                />
                <LettersCard
                  index={13}
                  scans={rw.scans}
                  pending={pendingMail}
                  landedId={landedId}
                  graph={rw.graph}
                  arriving={arriving}
                  onOpen={setOpenScan}
                  onDocument={(id) => void openDocument(id)}
                />
              </section>
            )}
            <WhereCard index={3} />
            <TodayCard index={4} />
            <PeopleCard index={5} />
            <MemoryLogCard
              index={6}
              records={rw.records}
              zone={zone}
              now={rw.now}
            />
            <NoteCard index={7} />
            <MomentsCard
              index={8}
              records={rw.records}
              zone={zone}
              onOpen={openSource}
              arriving={arriving}
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
              .slice(0, 2)
              .map(([, node]) => node)}
            {live.status && (
              <section
                className="mail-widgets dashboard-mail"
                aria-label="Calendar and notes"
              >
                <CalendarCard
                  index={12}
                  scans={rw.scans}
                  pending={pendingMail}
                  landedId={landedId}
                  reminders={rw.reminders}
                  graph={rw.graph}
                  zone={zone}
                  arriving={arriving}
                  disabled={rw.connection !== 'live'}
                  onOpen={setOpenScan}
                  onDocument={(id) => void openDocument(id)}
                  onSeen={rw.reminderSeen}
                />
                <LettersCard
                  index={13}
                  scans={rw.scans}
                  pending={pendingMail}
                  landedId={landedId}
                  graph={rw.graph}
                  arriving={arriving}
                  onOpen={setOpenScan}
                  onDocument={(id) => void openDocument(id)}
                />
              </section>
            )}
            {care
              .filter(([tags]) => tags.includes(filter))
              .slice(2)
              .map(([, node]) => node)}
          </div>
        )}
      </main>

      <Arrivals
        items={rw.arrivals}
        onDone={rw.dismissArrival}
        onArriving={setArriving}
        onLanded={setLandedId}
      />

      {openScan && (
        <dialog className="lightbox lb-mail" open aria-label="Scanned mail">
          <button
            type="button"
            className="lb-close"
            onClick={() => setOpenScan(null)}
            aria-label="Close"
          >
            <X />
          </button>
          <div className="lb-mail-doc">
            {isBill(openScan) ? (
              <BillSlip document={openScan} />
            ) : (
              <>
                <PostcardBack document={openScan} />
                <PostcardFront document={openScan} />
              </>
            )}
          </div>
          {openScan.image_url && (
            <img src={openScan.image_url} alt="The scan Rose took" />
          )}
          <p>
            Scanned{' '}
            {new Date(openScan.created_at * 1000).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: zone,
            })}
            {openScan.source === 'model'
              ? ' · read by the vision model'
              : openScan.source === 'template'
                ? ' · details filled from the printed demo mail'
                : ' · read by the model, gaps filled from the printed demo'}
          </p>
        </dialog>
      )}
      {open && (
        <dialog className="lightbox" open aria-label="Recording">
          <button
            type="button"
            className="lb-close"
            onClick={() => setOpen(null)}
            aria-label="Close"
          />
          {open.kind === 'context' ? (
            <div className="lb-document">
              <h2>{open.title || 'Saved source'}</h2>
              <pre>{open.text}</pre>
            </div>
          ) : open.kind === 'frame' ? (
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
