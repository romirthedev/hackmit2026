'use client';
import './workspace.css';
import { MemoryAurora, FrameImage, CatalogButton } from '@/components/catalog';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
// Serve authenticated originals directly; native audio has an adjacent transcript.
// Static FastAPI entry points need document navigation, without RSC prefetch.
/* oxlint-disable next/no-img-element, jsx-a11y/media-has-caption, next/no-html-link-for-pages */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Aperture,
  ArrowUpRight,
  Camera,
  Clock3,
  Pause,
  Play,
  Search,
  Wifi,
  HardDrive,
  ArrowLeft,
  ArrowRight,
  Volume2,
  Upload,
  Trash2,
  Bell,
  Download,
  LogOut,
  Activity,
  Box,
  FileAudio,
  RefreshCw,
  ShieldCheck,
  ChevronRight,
  Sparkles,
  CalendarDays,
  X,
  CheckCircle2,
  Monitor,
  Users,
  Link2,
} from 'lucide-react';
import Login from '@/components/login';
import { WorkspaceTabsList } from '@/components/workspace-navigation';
import { Brand } from '@/components/brand';
import { BrowserPairing } from '@/components/browser-pairing';
import { ContextPanel } from '@/components/context-panel';
import { ComputerPanel } from '@/components/computer-panel';
import { PeoplePanel } from '@/components/people-panel';
import { UsageCard } from '@/components/usage-card';
import { MemoryCommand } from '@/components/memory-command';
import { MemoryComposer } from '@/components/memory-composer';
import { MemoryLibrary } from '@/components/memory-library';
import {
  AnimatedNumber,
  MemoryFilmstrip,
  ProcessingJourney,
} from '@/components/memory-details';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { AudioCapture } from '@/components/audio-capture';
import { SceneView } from '@/components/scene-view';
import {
  Sidebar,
  SidebarProvider,
  SidebarInset,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  api,
  AUTH_REQUIRED_EVENT,
  isAuthenticationError,
  bytes,
  clock,
  recordingClock,
  type Recording,
  type Status,
  type Answer,
  type Rule,
  type Alert,
  type Scene,
} from '@/lib/api';
const EMPTY_SCENE: Scene = {
  available: false,
  points: [],
  cameras: [],
  frames: [],
};

export default function Home() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [records, setRecords] = useState<Recording[]>([]),
    [answers, setAnswers] = useState<Answer[]>([]),
    [rules, setRules] = useState<Rule[]>([]),
    [alerts, setAlerts] = useState<Alert[]>([]),
    [scene, setScene] = useState<Scene>(EMPTY_SCENE);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState(''),
    [search, setSearch] = useState(''),
    [results, setResults] = useState<Recording[] | null>(null),
    [rule, setRule] = useState(''),
    [selected, setSelected] = useState<Recording | null>(null),
    [deleting, setDeleting] = useState<Recording | null>(null),
    [replayId, setReplayId] = useState<string | null>(null),
    [playing, setPlaying] = useState(false),
    [tab, setTab] = useState('memory'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false),
    [asking, setAsking] = useState(false),
    [historyMode, setHistoryMode] = useState<'recent' | 'search' | 'earlier'>(
      'recent',
    ),
    [hasEarlier, setHasEarlier] = useState(true);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = useRef(true);
  const signedOut = useRef(false);
  const loading = useRef(false);
  const pollController = useRef<AbortController | null>(null);
  useEffect(() => {
    const expire = () => {
      signedOut.current = true;
      pollController.current?.abort();
      setAuth(false);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, expire);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, expire);
  }, []);
  useEffect(() => {
    const select = () => {
      const destination = window.location.hash.slice(1);
      if (destination === 'usage') setTab('system');
      else if (
        [
          'memory',
          'scene',
          'monitor',
          'system',
          'context',
          'people',
          'computer',
        ].includes(destination)
      )
        setTab(destination);
    };
    select();
    window.addEventListener('hashchange', select);
    return () => window.removeEventListener('hashchange', select);
  }, []);
  const index = replayId
    ? Math.max(
        0,
        records.findIndex((recording) => recording.id === replayId),
      )
    : 0;
  const setIndex = useCallback(
    (next: number | ((previous: number) => number)) => {
      setReplayId((previous) => {
        const before = previous
          ? Math.max(
              0,
              records.findIndex((recording) => recording.id === previous),
            )
          : 0;
        const target = typeof next === 'function' ? next(before) : next;
        return target === 0 ? null : records[target]?.id || null;
      });
    },
    [records],
  );
  const load = useCallback(async () => {
    if (signedOut.current || loading.current) return;
    loading.current = true;
    const controller = new AbortController();
    pollController.current = controller;
    const options = { signal: controller.signal };
    try {
      const [s, r, a, ru, al] = await Promise.all([
        api<Status>('/status', options),
        api<Recording[]>('/recordings', options),
        api<Answer[]>('/answers', options),
        api<Rule[]>('/rules', options),
        api<Alert[]>('/alerts', options),
      ]);
      if (signedOut.current || controller.signal.aborted) return;
      setStatus(s);
      setRecords(r);
      setAnswers(a);
      setRules(ru);
      setAlerts(al);
      setAuth(true);
      setError('');
      if (initial.current) {
        initial.current = false;
        api<Scene>('/scene', options)
          .then((next) => {
            if (!signedOut.current && !controller.signal.aborted)
              setScene(next);
          })
          .catch(() => {});
      }
    } catch (e) {
      if (signedOut.current || controller.signal.aborted) return;
      if (isAuthenticationError(e)) {
        signedOut.current = true;
        setAuth(false);
      } else setError(String(e));
    } finally {
      if (pollController.current === controller) loading.current = false;
    }
  }, []);
  useEffect(() => {
    if (auth === false) return;
    if (window.location.hash.startsWith('#connect=')) {
      // oxlint-disable-next-line react/react-compiler -- Route an explicit invitation through sign-in.
      setAuth(false);
      return;
    }
    // oxlint-disable-next-line react/react-compiler -- Synchronize state with the external recording server.
    void load();
    const t = setInterval(load, 5000);
    return () => {
      clearInterval(t);
      pollController.current?.abort();
    };
  }, [load, auth]);
  useEffect(() => {
    if (!playing) return;
    if (index <= 0) {
      // oxlint-disable-next-line react/react-compiler -- Stop the replay timer at its endpoint.
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIndex((i) => Math.max(0, i - 1)), 1000);
    return () => clearTimeout(t);
  }, [playing, index, setIndex]);
  const current = records[Math.min(index, Math.max(0, records.length - 1))];
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function ask(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !question.trim()) return;
    if (!validTimeRange()) return;
    setAsking(true);
    await action(async () => {
      const a = await api<Answer>('/ask', {
        method: 'POST',
        body: JSON.stringify({
          question,
          after: from ? new Date(from).getTime() / 1000 : null,
          before: to ? new Date(to).getTime() / 1000 : null,
        }),
      });
      setAnswers((prev) => [a, ...prev.filter((v) => v.id !== a.id)]);
      setQuestion('');
    });
    setAsking(false);
  }
  function validTimeRange() {
    if (from && to && new Date(from) > new Date(to)) {
      setError('Choose an end time after the start time.');
      setFiltersOpen(true);
      return false;
    }
    return true;
  }
  function clearSearch() {
    setResults(null);
    setSearch('');
    setFrom('');
    setTo('');
    setHistoryMode('recent');
    setHasEarlier(true);
  }
  function suggestQuestion(value: string) {
    setQuestion(value);
    questionRef.current?.focus();
  }
  async function signOut() {
    setBusy(true);
    try {
      await api('/logout', { method: 'POST' });
      signedOut.current = true;
      pollController.current?.abort();
      setAuth(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function doSearch(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validTimeRange()) return;
    await action(async () => {
      const params = new URLSearchParams({ q: search, limit: '100' });
      if (from) params.set('after', String(new Date(from).getTime() / 1000));
      if (to) params.set('before', String(new Date(to).getTime() / 1000));
      setResults(await api<Recording[]>('/events?' + params));
      setHistoryMode('search');
      historyRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
    });
  }
  async function upload(file: File) {
    await action(async () => {
      const kind = file.type.startsWith('image') ? 'frame' : 'audio';
      await api('/ingest/' + kind, {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-Boot-ID': crypto.randomUUID(),
          'X-Sequence': '0',
          'X-Captured-At': String(file.lastModified / 1000),
        },
        body: file,
      });
      setNotice(
        'Recording saved. Analysis will appear when the model finishes.',
      );
    });
  }
  function speak(text: string) {
    if (!('speechSynthesis' in window)) {
      setError('Speech playback is unavailable in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(
      new SpeechSynthesisUtterance(text.replace(/\[[0-9a-f-]{36}\]/g, '')),
    );
  }
  if (auth === false) return <Login />;
  if (auth === null)
    return (
      <main className="shell">
        <header>
          <Brand />
        </header>
        <div className="connect-panel loading-panel">
          <Activity className={error ? '' : 'pulse'} />
          <h2>
            {error
              ? 'Unable to reach your workspace'
              : 'Opening your workspace'}
          </h2>
          <p>{error || 'Checking the local recording server…'}</p>
          <CatalogButton onClick={() => load()}>Try again</CatalogButton>
        </div>
      </main>
    );
  const online = status?.devices.some(
    (d) => Date.now() / 1000 - d.last_seen < 30,
  );
  const unread = alerts.filter((a) => !a.seen).length;
  const pageTitles: Record<string, [string, string]> = {
    memory: ['Your memory', 'Find a moment. Pick up where you left off.'],
    scene: ['Your surroundings', 'Revisit a space from your recordings.'],
    monitor: ['Watch for me', 'A little help noticing what matters.'],
    context: [
      'Connected context',
      'Your authorized notes, appointments, and contacts.',
    ],
    people: ['People', 'Confirm the people you want your memory to recognize.'],
    computer: [
      'Your Mac',
      'Ask Notch to help with something on your computer.',
    ],
    system: [
      'Device & storage',
      'Everything behind your memory, in one place.',
    ],
  };
  return (
    <SidebarProvider
      className="workspace"
      style={{ '--sidebar-width': '238px' } as React.CSSProperties}
    >
      <a href="#workspace-content" className="skip-link">
        Skip to workspace
      </a>
      <Tabs
        className="workspace-tabs"
        orientation="vertical"
        value={tab}
        onValueChange={(v) => {
          setTab(String(v));
          history.replaceState(null, '', `/workspace#${String(v)}`);
        }}
      >
        <Sidebar className="workspace-sidebar" collapsible="offcanvas">
          <SidebarHeader className="sidebar-top">
            <Brand />
          </SidebarHeader>
          <SidebarContent>
            <MemoryCommand
              records={records}
              timezone={status?.timezone}
              busy={busy}
              onSelect={setSelected}
              onNavigate={(destination) => {
                if (destination === 'import') fileRef.current?.click();
                else setTab(destination);
              }}
            />
            <p className="sidebar-label">WORKSPACE</p>
            <WorkspaceTabsList
              className="workspace-nav"
              aria-label="Workspace navigation"
            >
              <TabsTrigger value="memory">
                <Clock3 /> Your memory
              </TabsTrigger>
              <TabsTrigger value="monitor">
                <Bell /> Watch for me{' '}
                {unread > 0 && <span className="count">{unread}</span>}
              </TabsTrigger>
              <TabsTrigger value="scene">
                <Box /> 3D scene
              </TabsTrigger>
              <TabsTrigger value="context">
                <Link2 /> Connected context
              </TabsTrigger>
              <TabsTrigger value="people">
                <Users /> People
              </TabsTrigger>
              <TabsTrigger value="computer">
                <Monitor /> Your Mac
              </TabsTrigger>
              <TabsTrigger value="system">
                <Wifi /> Device & storage
              </TabsTrigger>
            </WorkspaceTabsList>
          </SidebarContent>
          <SidebarFooter className="sidebar-bottom">
            <CatalogButton
              className="quiet icon-button mobile-signout"
              aria-label="Sign out"
              onClick={signOut}
              disabled={busy}
            >
              <LogOut size={17} />
            </CatalogButton>
            <CatalogButton
              className="device-shortcut"
              onClick={() => setTab('system')}
            >
              <span className={'device-icon ' + (online ? 'connected' : '')}>
                <Camera size={19} />
              </span>
              <span>
                <strong>Your recorder</strong>
                <span
                  className={'connection-label ' + (online ? 'connected' : '')}
                >
                  <i />
                  {online
                    ? status?.paused
                      ? 'Capture paused'
                      : 'Connected'
                    : 'Not connected'}
                </span>
              </span>
              <ChevronRight size={16} />
            </CatalogButton>
            <div className="workspace-account">
              <span className="account-avatar">
                <Aperture size={18} />
              </span>
              <div>
                <strong>Personal workspace</strong>
                <span>
                  {status?.provider === 'ollama'
                    ? 'Local AI'
                    : 'Your recordings'}
                </span>
              </div>
              <CatalogButton
                className="quiet icon-button"
                aria-label="Sign out"
                title="Sign out"
                onClick={signOut}
                disabled={busy}
              >
                <LogOut size={17} />
              </CatalogButton>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset
          className="workspace-main"
          id="workspace-content"
          tabIndex={-1}
        >
          <header className="workspace-header">
            <div className="header-title-row">
              <SidebarTrigger className="mobile-menu-trigger" />
              <div className="workspace-heading">
                <p className="eyebrow">YOUR PERSONAL MEMORY</p>
                <h1>{pageTitles[tab][0]}</h1>
                <p>{pageTitles[tab][1]}</p>
              </div>
            </div>
            <div className="capture-actions">
              <a className="button quiet" href="/phone">
                Open phone
              </a>
              <CatalogButton
                className="quiet import-button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Upload size={16} /> Import
              </CatalogButton>
              <AudioCapture onUpdate={load} onError={setError} />
              <input
                ref={fileRef}
                className="hidden"
                type="file"
                aria-label="Import a recording"
                accept="image/jpeg,audio/wav,audio/webm,audio/ogg,audio/mp4"
                onChange={(e) => {
                  if (e.target.files?.[0]) void upload(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </header>
          <div className="workspace-body">
            {error && (
              <div className="banner error" role="alert">
                <span>{error.replace(/^Error: /, '')}</span>
                <CatalogButton
                  className="quiet icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError('')}
                >
                  <X size={16} />
                </CatalogButton>
              </div>
            )}
            {notice && (
              <output className="banner">
                <CheckCircle2 size={18} />
                <span>{notice}</span>
                <CatalogButton
                  className="quiet icon-button"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice('')}
                >
                  <X size={16} />
                </CatalogButton>
              </output>
            )}
            <TabsContent value="memory">
              <form className="search-row" onSubmit={doSearch}>
                <div className="search-field">
                  <Search size={19} />
                  <Input
                    aria-label="Search observations and transcripts"
                    placeholder="Search your memories…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <PopoverTrigger
                    render={
                      <CatalogButton
                        variant="outline"
                        className={
                          'filter-button ' + (from || to ? 'has-filter' : '')
                        }
                      />
                    }
                  >
                    <CalendarDays size={16} />
                    {from || to ? 'Date range set' : 'All time'}
                  </PopoverTrigger>
                  <PopoverContent className="date-filter" align="end">
                    <h3>Choose a time range</h3>
                    <p className="muted">Applies to searches and questions.</p>
                    <label htmlFor="date-from">From</label>
                    <Input
                      id="date-from"
                      type="datetime-local"
                      value={from}
                      max={to || undefined}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                    <label htmlFor="date-to">To</label>
                    <Input
                      id="date-to"
                      type="datetime-local"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => setTo(e.target.value)}
                    />
                    <div className="row">
                      <CatalogButton
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setFrom('');
                          setTo('');
                        }}
                      >
                        Reset dates
                      </CatalogButton>
                      <CatalogButton
                        type="button"
                        onClick={() => setFiltersOpen(false)}
                      >
                        Done
                      </CatalogButton>
                    </div>
                  </PopoverContent>
                </Popover>
                <CatalogButton disabled={busy} type="submit">
                  Search
                </CatalogButton>
              </form>
              <div className="metrics">
                <Card>
                  <span className="metric-icon">
                    <Camera size={18} />
                  </span>
                  <span className="metric-copy">
                    <span>Recordings saved</span>
                    <strong>
                      <AnimatedNumber value={status?.received || 0} />
                    </strong>
                  </span>
                </Card>
                <Card>
                  <span className="metric-icon">
                    <CheckCircle2 size={18} />
                  </span>
                  <span className="metric-copy">
                    <span>Analyzed recordings</span>
                    <strong>
                      <AnimatedNumber value={status?.analyzed || 0} />
                    </strong>
                  </span>
                </Card>
                <Card>
                  <span className="metric-icon">
                    <Clock3 size={18} />
                  </span>
                  <span className="metric-copy">
                    <span>Processing</span>
                    <strong>
                      <AnimatedNumber value={status?.pending || 0} />
                    </strong>
                  </span>
                </Card>
                <Card>
                  <span className="metric-icon">
                    <HardDrive size={18} />
                  </span>
                  <span className="metric-copy">
                    <span>Memory stored</span>
                    <strong>
                      <AnimatedNumber
                        value={status?.stored_bytes || 0}
                        format={bytes}
                      />
                    </strong>
                  </span>
                </Card>
              </div>

              {status && (
                <ProcessingJourney
                  status={status}
                  onOpen={() => setTab('system')}
                />
              )}
              <div className="memory-grid">
                <Card className="visual-panel">
                  <div className="panel-top">
                    <span className="panel-heading">
                      <span
                        className={
                          'live-dot ' +
                          (!online || status?.paused ? 'inactive' : '')
                        }
                      />
                      {index === 0 ? 'Latest recording' : 'Replaying a moment'}
                    </span>
                    <span className="meta">
                      {current
                        ? clock(current.captured_at, status?.timezone)
                        : 'No recordings yet'}
                    </span>
                  </div>
                  <div className="camera-stage">
                    {current ? (
                      <Media recording={current} />
                    ) : (
                      <div className="stage-empty">
                        <MemoryAurora />
                        <Camera size={44} />
                        <h2>No recordings yet</h2>
                        <p>
                          Record on your phone or import a recording. Your
                          moments will appear here.
                        </p>
                        <div className="empty-actions">
                          <CatalogButton
                            className="quiet"
                            onClick={() => fileRef.current?.click()}
                            disabled={busy}
                          >
                            <Upload size={16} /> Import recording
                          </CatalogButton>
                          <a className="text-button" href="/phone">
                            Open phone <ArrowUpRight size={14} />
                          </a>
                        </div>
                      </div>
                    )}
                    {current && (
                      <span className="frame-state">
                        {current.status === 'done'
                          ? 'Analyzed'
                          : current.status || 'Evidence'}{' '}
                        · {recordingClock(current)}
                      </span>
                    )}
                  </div>
                  <MemoryFilmstrip
                    records={records}
                    currentId={current?.id}
                    timezone={status?.timezone}
                    onSelect={(next) => {
                      setIndex(next);
                      setPlaying(false);
                    }}
                  />
                  <div className="timeline-controls">
                    <CatalogButton
                      className="quiet icon-button"
                      disabled={!records.length || index >= records.length - 1}
                      onClick={() =>
                        setIndex((i) => Math.min(records.length - 1, i + 1))
                      }
                      aria-label="Previous recording"
                    >
                      <ArrowLeft size={17} />
                    </CatalogButton>
                    <CatalogButton
                      className="quiet icon-button replay-button"
                      disabled={records.length < 2}
                      onClick={() => {
                        if (!playing && index === 0)
                          setIndex(records.length - 1);
                        setPlaying(!playing);
                      }}
                      aria-label={playing ? 'Pause replay' : 'Play replay'}
                    >
                      {playing ? <Pause size={17} /> : <Play size={17} />}
                    </CatalogButton>
                    <Slider
                      aria-label="Recording timeline"
                      disabled={records.length < 2}
                      value={[Math.max(0, records.length - 1 - index)]}
                      min={0}
                      max={Math.max(1, records.length - 1)}
                      onValueChange={(v) => {
                        const n = Array.isArray(v) ? v[0] : v;
                        setIndex(Math.max(0, records.length - 1 - n));
                        setPlaying(false);
                      }}
                    />
                    <CatalogButton
                      className="quiet icon-button"
                      disabled={!records.length || index === 0}
                      onClick={() => setIndex((i) => Math.max(0, i - 1))}
                      aria-label="Next recording"
                    >
                      <ArrowRight size={17} />
                    </CatalogButton>
                  </div>
                  <div className="capture-status-row">
                    <span className="meta">
                      {current
                        ? new Date(
                            current.captured_at * 1000,
                          ).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            timeZone: status?.timezone,
                          })
                        : 'Ready when you are'}
                    </span>
                    <CatalogButton
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          api('/capture/pause', {
                            method: 'POST',
                            body: JSON.stringify({ paused: !status?.paused }),
                          }),
                        )
                      }
                    >
                      {status?.paused ? (
                        <Play size={14} />
                      ) : (
                        <Pause size={14} />
                      )}
                      {status?.paused ? 'Resume capture' : 'Pause capture'}
                    </CatalogButton>
                  </div>
                  <div className="observation">
                    <div className="row">
                      <h3>In this moment</h3>
                      {current && (
                        <CatalogButton
                          className="text-button"
                          onClick={() => setSelected(current)}
                        >
                          Open evidence <ArrowUpRight size={14} />
                        </CatalogButton>
                      )}
                    </div>
                    <p>
                      {current?.summary ||
                        (current
                          ? 'Saved safely. A description will appear after analysis.'
                          : 'Each recording will include a description and its original evidence.')}
                    </p>
                    <div className="chips">
                      {current?.objects?.map((o, i) => (
                        <CatalogButton
                          key={i}
                          className="chip"
                          onClick={() => {
                            setSearch(o.label);
                            suggestQuestion(
                              'Where was my ' + o.label + ' last observed?',
                            );
                          }}
                        >
                          {o.label}
                          <span>{o.location}</span>
                        </CatalogButton>
                      ))}
                    </div>
                    {current?.error && (
                      <p className="error-text">
                        Analysis needs attention: {current.error}
                      </p>
                    )}
                  </div>
                </Card>
                <Card className="recall-panel">
                  <div className="panel-top">
                    <h2 className="recall-heading">Ask your memory</h2>
                    <Sparkles size={18} />
                  </div>
                  <p className="muted">
                    Find answers in your recordings, with evidence to revisit.
                  </p>
                  <MemoryComposer
                    question={question}
                    onChange={setQuestion}
                    onSubmit={ask}
                    inputRef={questionRef}
                    busy={busy}
                    asking={asking}
                    local={status?.provider === 'ollama'}
                    model={status?.model}
                    onVoiceUpdate={() => {
                      void load();
                      setNotice(
                        'Voice question saved. The answer will appear here after transcription.',
                      );
                    }}
                    onError={setError}
                  />
                  {(from || to) && (
                    <p className="filter-note">
                      <CalendarDays size={13} /> Using your selected time range{' '}
                      <CatalogButton
                        className="text-button"
                        onClick={() => {
                          setFrom('');
                          setTo('');
                        }}
                      >
                        Clear
                      </CatalogButton>
                    </p>
                  )}
                  {asking && (
                    <output className="thinking-note">
                      <span className="pulse">
                        <Sparkles size={15} />
                      </span>{' '}
                      Looking through your recordings…
                    </output>
                  )}
                  <div className="answers" aria-live="polite">
                    {answers.length === 0 ? (
                      <div className="empty-answer">
                        <span className="meta">TRY ASKING</span>
                        {[
                          'Where did I leave my keys?',
                          'What did we discuss about the project?',
                          'What changed on the table?',
                        ].map((q) => (
                          <CatalogButton
                            key={q}
                            className="suggestion"
                            onClick={() => suggestQuestion(q)}
                          >
                            {q}
                            <ArrowUpRight size={14} />
                          </CatalogButton>
                        ))}
                      </div>
                    ) : (
                      answers.slice(0, 6).map((a) => (
                        <Card className="answer memory-enter" key={a.id}>
                          <div className="row">
                            <span className="meta">
                              {clock(a.created_at, status?.timezone)}
                            </span>
                            <CatalogButton
                              className="quiet icon-button"
                              aria-label="Read answer aloud"
                              onClick={() => speak(a.answer)}
                              disabled={
                                a.mode === 'checking' ||
                                (!!status?.verification_enabled &&
                                  !a.verification?.receipt?.claims_reviewed)
                              }
                            >
                              <Volume2 size={15} />
                            </CatalogButton>
                          </div>
                          <h3>{a.question}</h3>
                          <span className="answer-kind">
                            {a.mode === 'checking'
                              ? 'Draft · checking original evidence'
                              : a.verification?.receipt?.claims_reviewed
                                ? a.mode === 'insufficient'
                                  ? 'Reviewed · evidence incomplete'
                                  : 'Original evidence reviewed'
                                : 'Not independently reviewed'}
                          </span>
                          <p>
                            {a.answer.replace(
                              /\[([0-9a-f-]{36})\]/g,
                              (_, id) => {
                                const i = a.evidence.findIndex(
                                  (e) => e.id === id,
                                );
                                return i >= 0 ? `[${i + 1}]` : '[unverified]';
                              },
                            )}
                          </p>
                          <span className="answer-kind">
                            {a.grounded
                              ? 'Recorded evidence cited'
                              : 'Evidence incomplete'}
                          </span>
                          <div className="evidence-links">
                            {a.evidence.map((r, i) => (
                              <CatalogButton
                                className="chip"
                                key={r.id}
                                onClick={() => setSelected(r)}
                              >
                                [{i + 1}]{' '}
                                {r.source === 'notch'
                                  ? r.title
                                  : clock(r.captured_at, status?.timezone)}{' '}
                                {r.source === 'notch'
                                  ? 'Notch'
                                  : r.kind === 'audio'
                                    ? 'Audio'
                                    : 'Frame'}
                              </CatalogButton>
                            ))}
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                </Card>
              </div>
              <section className="history" ref={historyRef}>
                <div className="row">
                  <h2>
                    {historyMode === 'search'
                      ? 'Search results'
                      : 'Recent memories'}
                  </h2>
                  <div className="history-actions">
                    <span className="meta">
                      {(results ?? records).length} recordings
                      {historyMode === 'search' && search
                        ? ` matching “${search}”`
                        : ''}
                    </span>
                    {results !== null && (
                      <CatalogButton
                        className="text-button"
                        onClick={clearSearch}
                      >
                        <X size={14} /> Clear
                      </CatalogButton>
                    )}
                  </div>
                </div>
                <MemoryLibrary
                  records={results ?? records}
                  timezone={status?.timezone}
                  searching={historyMode === 'search'}
                  onSelect={setSelected}
                />
                {historyMode !== 'search' &&
                  hasEarlier &&
                  (results ?? records).length >= 60 && (
                    <CatalogButton
                      className="quiet load-earlier"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const visible = results ?? records;
                          const older = await api<Recording[]>(
                            '/recordings?before=' +
                              (visible[visible.length - 1].captured_at - 0.001),
                          );
                          setResults([...visible, ...older]);
                          setHistoryMode('earlier');
                          setHasEarlier(older.length >= 60);
                        })
                      }
                    >
                      Load earlier recordings
                    </CatalogButton>
                  )}
              </section>
            </TabsContent>
            <TabsContent value="scene">
              <div className="scene-header">
                <div>
                  <h2>Your surroundings, reconstructed.</h2>
                  <p className="muted">
                    Static geometry from a scan. Object markers show
                    observations at a particular time.
                  </p>
                </div>
                <CatalogButton
                  className="quiet"
                  onClick={() =>
                    void action(async () =>
                      setScene(await api<Scene>('/scene')),
                    )
                  }
                >
                  <RefreshCw size={16} /> Refresh scene
                </CatalogButton>
              </div>
              <SceneView
                scene={scene}
                at={current?.captured_at || Date.now() / 1000}
              />
              {scene.available && (
                <div className="timeline-controls">
                  <span className="meta">
                    Observed through{' '}
                    {current
                      ? clock(current.captured_at, status?.timezone)
                      : 'latest scan'}
                  </span>
                  <Slider
                    aria-label="Object history timeline"
                    value={[Math.max(0, records.length - 1 - index)]}
                    min={0}
                    max={Math.max(1, records.length - 1)}
                    disabled={records.length < 2}
                    onValueChange={(v) => {
                      setIndex(
                        Math.max(
                          0,
                          records.length - 1 - (Array.isArray(v) ? v[0] : v),
                        ),
                      );
                      setPlaying(false);
                    }}
                  />
                </div>
              )}
            </TabsContent>
            <TabsContent value="monitor">
              <div className="monitor-grid">
                <Card className="card">
                  <span className="section-icon">
                    <Bell size={20} />
                  </span>
                  <h2>What should I look out for?</h2>
                  <p className="muted">
                    Alerts use recent analyzed observations. A growing analysis
                    queue can delay them.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(async () => {
                        await api('/rules', {
                          method: 'POST',
                          body: JSON.stringify({ instruction: rule }),
                        });
                        setRule('');
                      });
                    }}
                  >
                    <label htmlFor="rule">Monitoring request</label>
                    <Textarea
                      id="rule"
                      value={rule}
                      onChange={(e) => setRule(e.target.value)}
                      placeholder="Tell me if I pick up my bag while my wallet is visibly on the table."
                      required
                      minLength={3}
                      maxLength={1000}
                    />
                    <CatalogButton
                      type="submit"
                      disabled={busy}
                      className="mt-4"
                    >
                      <Bell size={16} /> Watch for this
                    </CatalogButton>
                  </form>
                  <div className="rule-list">
                    {rules.map((r) => (
                      <div key={r.id} className="row">
                        <p>{r.instruction}</p>
                        <CatalogButton
                          className="quiet icon-button"
                          aria-label="Remove monitoring rule"
                          onClick={() =>
                            void action(() =>
                              api('/rules/' + r.id, { method: 'DELETE' }),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </CatalogButton>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card className="card">
                  <h2>Your alerts</h2>
                  {alerts.length ? (
                    alerts.map((a) => (
                      <Card key={a.id} className="alert-entry">
                        <span className="meta">
                          {clock(a.created_at, status?.timezone)}
                        </span>
                        <p>{a.message}</p>
                        <div className="row">
                          <CatalogButton
                            className="text-button"
                            onClick={() => {
                              const r = records.find(
                                (r) => r.id === a.event_id,
                              );
                              if (r) setSelected(r);
                              else
                                void action(async () => {
                                  setSelected(
                                    await api<Recording>(
                                      '/events/' + a.event_id,
                                    ),
                                  );
                                });
                            }}
                          >
                            View evidence <ArrowUpRight size={14} />
                          </CatalogButton>
                          {!a.seen && (
                            <CatalogButton
                              className="quiet"
                              onClick={() =>
                                void action(() =>
                                  api('/alerts/' + a.id + '/seen', {
                                    method: 'POST',
                                  }),
                                )
                              }
                            >
                              Mark read
                            </CatalogButton>
                          )}
                        </div>
                      </Card>
                    ))
                  ) : (
                    <p className="muted">
                      All quiet for now. When a recording matches one of your
                      requests, it will appear here with its evidence.
                    </p>
                  )}
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="context">
              <ContextPanel />
            </TabsContent>
            <TabsContent value="people">
              <PeoplePanel />
            </TabsContent>
            <TabsContent value="computer">
              <ComputerPanel visible={tab === 'computer'} />
            </TabsContent>
            <TabsContent value="system">
              <div className="system-grid">
                <UsageCard />
                <BrowserPairing />
                <Card className="card">
                  <h2>Necklace connection</h2>
                  {status?.devices.length ? (
                    status.devices.map((d) => (
                      <div key={d.id}>
                        <div className="row">
                          <h3>{d.id}</h3>
                          <span className="status">
                            {Date.now() / 1000 - d.last_seen < 30
                              ? 'Online'
                              : 'Offline'}
                          </span>
                        </div>
                        <dl>
                          <dt>Last contact</dt>
                          <dd>{clock(d.last_seen, status.timezone)}</dd>
                          <dt>On-device queue</dt>
                          <dd>{d.state.queued} recordings</dd>
                          <dt>Reported missed captures</dt>
                          <dd>{d.state.dropped}</dd>
                          <dt>Wi-Fi signal</dt>
                          <dd>{d.state.rssi} dBm</dd>
                          <dt>Free SD space</dt>
                          <dd>{bytes(d.state.free_sd_bytes)}</dd>
                        </dl>
                        {d.state.error && (
                          <p className="error-text">{d.state.error}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <>
                      <p className="muted">
                        No device has checked in. Provision the ESP32 with the
                        server address, Wi-Fi details, and device key.
                      </p>
                      <ol>
                        <li>Insert a FAT32 microSD card.</li>
                        <li>Flash the firmware over USB.</li>
                        <li>Power it from a USB battery bank.</li>
                        <li>Keep the necklace and server on the same Wi-Fi.</li>
                      </ol>
                    </>
                  )}
                </Card>
                <Card className="card">
                  <h2>Memory health</h2>
                  <dl>
                    <dt>Vision model</dt>
                    <dd>{status?.model}</dd>
                    <dt>Provider</dt>
                    <dd>{status?.provider}</dd>
                    <dt>Average analysis time</dt>
                    <dd>
                      {status?.average_analysis_ms
                        ? (status.average_analysis_ms / 1000).toFixed(1) + ' s'
                        : 'Not measured yet'}
                    </dd>
                    <dt>Storage allowance</dt>
                    <dd>{bytes(status?.storage_limit_bytes || 0)}</dd>
                    <dt>Disk free</dt>
                    <dd>{bytes(status?.free_bytes || 0)}</dd>
                    <dt>Failed analysis jobs</dt>
                    <dd>{status?.failed}</dd>
                    <dt>Sequence gaps so far</dt>
                    <dd>{status?.observed_sequence_gaps}</dd>
                    <dt>Missing semantic embeddings</dt>
                    <dd>{status?.embedding_failures}</dd>
                    <dt>Image retrieval</dt>
                    <dd>
                      {status?.visual_index?.enabled
                        ? `${status.visual_index.indexed} indexed · ${status.visual_index.pending} pending · ${status.visual_index.failed} failed`
                        : 'Not enabled'}
                    </dd>
                  </dl>
                  <div className="row">
                    <CatalogButton
                      className="quiet"
                      disabled={
                        busy ||
                        !(status?.failed || status?.visual_index?.failed)
                      }
                      onClick={() =>
                        void action(() => api('/retry', { method: 'POST' }))
                      }
                    >
                      <RefreshCw size={16} /> Retry failures
                    </CatalogButton>
                    <CatalogButton
                      variant="outline"
                      nativeButton={false}
                      render={
                        <a
                          href="/api/export"
                          download="rewind-memory.json"
                          aria-label="Export metadata"
                        />
                      }
                    >
                      <Download size={16} /> Export metadata
                    </CatalogButton>
                  </div>
                  <p className="meta mt-4">
                    Original recordings are never automatically deleted. At the
                    storage limit, uploads wait on the recording device.
                  </p>
                </Card>
              </div>
            </TabsContent>
            <footer className="workspace-footer">
              <span>
                <ShieldCheck size={14} /> Originals saved. Answers linked to
                evidence.
              </span>
              <span>{status?.timezone.replaceAll('_', ' ')}</span>
            </footer>
          </div>
        </SidebarInset>
      </Tabs>
      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <DialogContent className="evidence-dialog">
          <DialogTitle>
            {selected?.source === 'notch'
              ? 'Connected source'
              : 'Recorded evidence'}
          </DialogTitle>
          <DialogDescription>
            {selected
              ? new Date(selected.captured_at * 1000).toLocaleString()
              : ''}{' '}
            · {selected ? recordingClock(selected) : 'recording'}
          </DialogDescription>
          {selected && (
            <>
              <Media recording={selected} />
              {selected.provenance?.source_sha256 && (
                <p className="muted">
                  Clip #{selected.provenance.clip_index} ·{' '}
                  {selected.provenance.frame_index != null
                    ? `Source frame #${selected.provenance.frame_index} · `
                    : ''}
                  {selected.provenance.source_offset.toFixed(3)} seconds into
                  source
                  <br />
                  Source {selected.provenance.source_sha256.slice(0, 12)} ·
                  zero-based numbering
                </p>
              )}
              <p>{selected.summary || 'Analysis not yet available.'}</p>
              {selected.transcript && (
                <div className="transcript">
                  <h3>Automatic transcript</h3>
                  <p>{selected.transcript}</p>
                  <small>
                    Speaker identity is not inferred. Verify exact wording
                    against the audio.
                  </small>
                </div>
              )}
              {selected.source !== 'notch' && (
                <div className="row">
                  <CatalogButton
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a
                        href={selected.media_url}
                        download
                        aria-label="Download original"
                      />
                    }
                  >
                    Download original
                  </CatalogButton>
                  <CatalogButton
                    className="quiet danger"
                    disabled={selected.source === 'notch'}
                    onClick={() => setDeleting(selected)}
                  >
                    <Trash2 size={16} /> Delete recording
                  </CatalogButton>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the original, its analysis, and stored answers that
            cite it. This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api('/media/' + deleting!.id, { method: 'DELETE' });
                  setDeleting(null);
                  setSelected(null);
                  setResults(null);
                  setHistoryMode('recent');
                  setHasEarlier(true);
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
function Media({ recording: r }: { recording: Recording }) {
  if (r.source === 'notch')
    return (
      <article className="context-document">
        <small>Notch · {r.context_kind}</small>
        <h3>{r.title}</h3>
        <p>{r.text}</p>
      </article>
    );
  return r.kind === 'frame' ? (
    <FrameImage
      className="evidence-image"
      src={r.media_url}
      alt={r.summary || 'Original recorded frame'}
    />
  ) : (
    <div className="audio-player">
      <FileAudio size={40} />
      <audio controls src={r.media_url} preload="metadata" />
      <p>{r.transcript || 'Recorded audio · transcription pending'}</p>
    </div>
  );
}
