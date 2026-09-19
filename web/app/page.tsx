'use client';
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
} from 'lucide-react';
import Login from '@/components/login';
import { AudioCapture } from '@/components/audio-capture';
import { SceneView } from '@/components/scene-view';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  bytes,
  clock,
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
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [tab, setTab] = useState('memory'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = useRef(true);
  const load = useCallback(async () => {
    try {
      const [s, r, a, ru, al] = await Promise.all([
        api<Status>('/status'),
        api<Recording[]>('/recordings'),
        api<Answer[]>('/answers'),
        api<Rule[]>('/rules'),
        api<Alert[]>('/alerts'),
      ]);
      setStatus(s);
      setRecords(r);
      setAnswers(a);
      setRules(ru);
      setAlerts(al);
      setAuth(true);
      if (initial.current) {
        initial.current = false;
        api<Scene>('/scene')
          .then(setScene)
          .catch(() => {});
      }
    } catch (e) {
      if (String(e).includes('access key')) setAuth(false);
      else setError(String(e));
    }
  }, []);
  useEffect(() => {
    if (auth === false) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, auth]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setIndex((i) => Math.max(0, i - 1)), 1000);
    return () => clearInterval(t);
  }, [playing]);
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
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
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
  }
  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    await action(async () => {
      const params = new URLSearchParams({ q: search, limit: '100' });
      if (from) params.set('after', String(new Date(from).getTime() / 1000));
      if (to) params.set('before', String(new Date(to).getTime() / 1000));
      setResults(await api<Recording[]>('/events?' + params));
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
          <a className="brand" href="/">
            <Aperture /> REWIND
          </a>
        </header>
        <div className="connect-panel loading-panel">
          <Activity />
          <h2>Connecting to your memory</h2>
          <p>{error || 'Checking the local recording server…'}</p>
          <button onClick={() => load()}>Try again</button>
        </div>
      </main>
    );
  const online = status?.devices.some(
    (d) => Date.now() / 1000 - d.last_seen < 30,
  );
  const percentage = status?.received
    ? Math.round((status.analyzed / status.received) * 100)
    : 0;
  return (
    <main className="shell dashboard">
      <header>
        <a className="brand" href="/">
          <Aperture /> REWIND<span className="tag">PERSONAL MEMORY</span>
        </a>
        <div className="header-actions">
          <span className={'status ' + (!online ? 'offline' : '')}>
            <i />
            {online ? 'Necklace connected' : 'Waiting for necklace'}
          </span>
          <button
            className="quiet icon-button"
            aria-label="Sign out"
            onClick={() =>
              action(async () => {
                await api('/logout', { method: 'POST' });
                setAuth(false);
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">YOUR DAY, WITH CONTEXT</p>
          <h1>Your day, within reach.</h1>
          <p>Return to the recording.</p>
        </div>
        <div className="capture-actions">
          <AudioCapture onUpdate={load} onError={setError} />
          <button className="quiet" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Import recording
          </button>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept="image/jpeg,audio/wav,audio/webm,audio/ogg,audio/mp4"
            onChange={(e) => {
              if (e.target.files?.[0]) upload(e.target.files[0]);
              e.target.value = '';
            }}
          />
          <button
            disabled={busy}
            onClick={() =>
              action(() =>
                api('/capture/pause', {
                  method: 'POST',
                  body: JSON.stringify({ paused: !status?.paused }),
                }),
              )
            }
          >
            {status?.paused ? <Play size={16} /> : <Pause size={16} />}{' '}
            {status?.paused ? 'Resume capture' : 'Pause capture'}
          </button>
        </div>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="quiet" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          {notice}
          <button className="quiet" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </div>
      )}
      <div className="metrics">
        <div>
          <Camera size={18} />
          <span>Recordings received</span>
          <strong>{status?.received.toLocaleString()}</strong>
        </div>
        <div>
          <Activity size={18} />
          <span>Analyzed</span>
          <strong>
            {percentage}
            <em>%</em>
          </strong>
        </div>
        <div>
          <Clock3 size={18} />
          <span>Waiting for analysis</span>
          <strong>{status?.pending.toLocaleString()}</strong>
        </div>
        <div>
          <HardDrive size={18} />
          <span>Originals retained</span>
          <strong>{bytes(status?.stored_bytes || 0)}</strong>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <div className="navigation-row">
          <TabsList variant="line">
            <TabsTrigger value="memory">
              <Clock3 /> Memory
            </TabsTrigger>
            <TabsTrigger value="scene">
              <Box /> 3D scene
            </TabsTrigger>
            <TabsTrigger value="monitor">
              <Bell /> Watch for me{' '}
              {alerts.filter((a) => !a.seen).length > 0 && (
                <span className="count">
                  {alerts.filter((a) => !a.seen).length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="system">
              <Wifi /> Device & storage
            </TabsTrigger>
          </TabsList>
          <span className="meta">
            {status?.timezone} · all received frames queued for AI
          </span>
        </div>
        <TabsContent value="memory">
          <div className="memory-grid">
            <section className="visual-panel">
              <div className="panel-top">
                <span className="eyebrow">
                  {index === 0 ? 'LATEST RECORDING' : 'REWIND'}
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
                    <Camera size={44} />
                    <h2>Your view starts here.</h2>
                    <p>
                      Power the necklace on your Wi-Fi, or import a recording to
                      try recall.
                    </p>
                    <button
                      className="quiet"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload size={16} /> Import a JPEG or audio clip
                    </button>
                  </div>
                )}
                {current && (
                  <span className="frame-state">
                    {current.status === 'done'
                      ? 'Analyzed'
                      : current.status || 'Evidence'}{' '}
                    ·{' '}
                    {current.clock_quality === 'received_only'
                      ? 'receive time only'
                      : 'device timestamp'}
                  </span>
                )}
              </div>
              <div className="timeline-controls">
                <button
                  className="quiet icon-button"
                  disabled={!records.length}
                  onClick={() =>
                    setIndex((i) => Math.min(records.length - 1, i + 1))
                  }
                  aria-label="Previous recording"
                >
                  <ArrowLeft size={17} />
                </button>
                <button
                  className="quiet icon-button"
                  disabled={!records.length}
                  onClick={() => setPlaying(!playing)}
                  aria-label={playing ? 'Pause replay' : 'Play replay'}
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <Slider
                  aria-label="Recording timeline"
                  value={[Math.max(0, records.length - 1 - index)]}
                  min={0}
                  max={Math.max(1, records.length - 1)}
                  onValueChange={(v) => {
                    const n = Array.isArray(v) ? v[0] : v;
                    setIndex(Math.max(0, records.length - 1 - n));
                    setPlaying(false);
                  }}
                />
                <button
                  className="quiet icon-button"
                  disabled={!records.length}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  aria-label="Next recording"
                >
                  <ArrowRight size={17} />
                </button>
              </div>
              <div className="observation">
                <div className="row">
                  <h3>Observed in this moment</h3>
                  {current && (
                    <button
                      className="text-button"
                      onClick={() => setSelected(current)}
                    >
                      Open evidence <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
                <p>
                  {current?.summary ||
                    'Descriptions will appear after AI analysis. Your original recordings are saved first.'}
                </p>
                <div className="chips">
                  {current?.objects?.map((o, i) => (
                    <button
                      key={i}
                      className="chip"
                      onClick={() => {
                        setSearch(o.label);
                        setQuestion(
                          'Where was my ' + o.label + ' last observed?',
                        );
                      }}
                    >
                      {o.label}
                      <span>{o.location}</span>
                    </button>
                  ))}
                </div>
                {current?.error && (
                  <p className="error-text">
                    Analysis pending: {current.error}
                  </p>
                )}
              </div>
            </section>
            <aside className="recall-panel">
              <div className="panel-top">
                <span className="eyebrow">ASK YOUR MEMORY</span>
                <Aperture size={18} />
              </div>
              <h2>“Where did I put it?”</h2>
              <p className="muted">
                An answer is only as useful as the evidence behind it.
              </p>
              <form onSubmit={ask}>
                <label htmlFor="question" className="sr-only">
                  Ask a question about your recordings
                </label>
                <textarea
                  id="question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Where was my wallet before I moved the notebook?"
                  rows={3}
                  required
                  maxLength={2000}
                />
                <div className="row">
                  <AudioCapture
                    question
                    onUpdate={() => {
                      load();
                      setNotice(
                        'Voice question saved. The answer will appear here after transcription.',
                      );
                    }}
                    onError={setError}
                  />
                  <button
                    type="submit"
                    disabled={busy || !question.trim()}
                    aria-label="Ask memory"
                  >
                    {busy ? 'Thinking…' : <ArrowUpRight size={20} />}
                  </button>
                </div>
              </form>
              <div className="answers" aria-live="polite">
                {answers.length === 0 ? (
                  <div className="empty-answer">
                    <span className="meta">TRY ASKING</span>
                    {[
                      'Where did I leave my keys?',
                      'What did we discuss about the project?',
                      'What changed on the table?',
                    ].map((q) => (
                      <button
                        key={q}
                        className="suggestion"
                        onClick={() => setQuestion(q)}
                      >
                        {q}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                ) : (
                  answers.slice(0, 6).map((a) => (
                    <article className="answer" key={a.id}>
                      <div className="row">
                        <span className="meta">
                          {clock(a.created_at, status?.timezone)}
                        </span>
                        <button
                          className="quiet icon-button"
                          aria-label="Read answer aloud"
                          onClick={() => speak(a.answer)}
                        >
                          <Volume2 size={15} />
                        </button>
                      </div>
                      <h3>{a.question}</h3>
                      <p>
                        {a.answer.replace(/\[([0-9a-f-]{36})\]/g, (_, id) => {
                          const i = a.evidence.findIndex((e) => e.id === id);
                          return i >= 0 ? `[${i + 1}]` : '[unverified]';
                        })}
                      </p>
                      <span className="answer-kind">
                        {a.grounded
                          ? 'Recorded evidence cited'
                          : 'Evidence incomplete'}
                      </span>
                      <div className="evidence-links">
                        {a.evidence.map((r, i) => (
                          <button
                            className="chip"
                            key={r.id}
                            onClick={() => setSelected(r)}
                          >
                            [{i + 1}] {clock(r.captured_at, status?.timezone)}{' '}
                            {r.kind === 'audio' ? 'Audio' : 'Frame'}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </aside>
          </div>
          <section className="history">
            <div className="row">
              <h2>A thread through your day</h2>
              <span className="meta">
                {results ? 'SEARCH RESULTS' : 'LATEST 60 RECORDINGS'}
              </span>
            </div>
            <form className="search-row" onSubmit={doSearch}>
              <div className="search-field">
                <Search size={18} />
                <input
                  aria-label="Search observations and transcripts"
                  placeholder="Search objects, words, places…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <label>
                From
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <button disabled={busy}>Search</button>
              {results && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setResults(null);
                    setSearch('');
                    setFrom('');
                    setTo('');
                  }}
                >
                  Clear
                </button>
              )}
            </form>
            <div className="recording-grid">
              {(results ?? records).map((r) => (
                <button
                  className="recording-card"
                  key={r.id}
                  onClick={() => setSelected(r)}
                >
                  {r.kind === 'frame' ? (
                    <img
                      loading="lazy"
                      src={r.media_url}
                      alt={r.summary || 'Recorded camera frame'}
                    />
                  ) : (
                    <div className="audio-thumb">
                      <FileAudio size={24} />
                      <span>Recorded audio</span>
                    </div>
                  )}
                  <div>
                    <span className="meta">
                      {clock(r.captured_at, status?.timezone)} · {r.kind}
                    </span>
                    <p>{r.summary || 'Saved · waiting for analysis'}</p>
                  </div>
                </button>
              ))}
            </div>
            {(results ?? records).length === 0 && (
              <p className="empty-line">
                {results
                  ? 'No matching evidence. Try fewer words or a wider time range.'
                  : 'Your recordings will appear here in time order.'}
              </p>
            )}
            {!results && records.length >= 60 && (
              <button
                className="quiet"
                onClick={() =>
                  action(async () => {
                    const older = await api<Recording[]>(
                      '/recordings?before=' +
                        (records[records.length - 1].captured_at - 0.001),
                    );
                    setResults([...records, ...older]);
                  })
                }
              >
                Load earlier recordings
              </button>
            )}
          </section>
        </TabsContent>
        <TabsContent value="scene">
          <div className="scene-header">
            <div>
              <h2>Your surroundings, reconstructed.</h2>
              <p className="muted">
                Static geometry from a scan. Object markers show observations at
                a particular time.
              </p>
            </div>
            <button
              className="quiet"
              onClick={() =>
                action(async () => setScene(await api<Scene>('/scene')))
              }
            >
              <RefreshCw size={16} /> Refresh scene
            </button>
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
                onValueChange={(v) =>
                  setIndex(records.length - 1 - (Array.isArray(v) ? v[0] : v))
                }
              />
            </div>
          )}
        </TabsContent>
        <TabsContent value="monitor">
          <div className="monitor-grid">
            <section className="card">
              <p className="eyebrow">A LITTLE HELP STAYING PRESENT</p>
              <h2>Tell REWIND what to watch for.</h2>
              <p className="muted">
                Alerts use recent analyzed observations. A growing analysis
                queue can delay them.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await api('/rules', {
                      method: 'POST',
                      body: JSON.stringify({ instruction: rule }),
                    });
                    setRule('');
                  });
                }}
              >
                <label htmlFor="rule">Monitoring request</label>
                <textarea
                  id="rule"
                  value={rule}
                  onChange={(e) => setRule(e.target.value)}
                  placeholder="Tell me if I pick up my bag while my wallet is visibly on the table."
                  required
                  minLength={3}
                  maxLength={1000}
                />
                <button disabled={busy} className="mt-4">
                  <Bell size={16} /> Watch for this
                </button>
              </form>
              <div className="rule-list">
                {rules.map((r) => (
                  <div key={r.id} className="row">
                    <p>{r.instruction}</p>
                    <button
                      className="quiet icon-button"
                      aria-label="Remove monitoring rule"
                      onClick={() =>
                        action(() =>
                          api('/rules/' + r.id, { method: 'DELETE' }),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className="card">
              <h2>Things worth your attention</h2>
              {alerts.length ? (
                alerts.map((a) => (
                  <article key={a.id} className="alert-entry">
                    <span className="meta">
                      {clock(a.created_at, status?.timezone)}
                    </span>
                    <p>{a.message}</p>
                    <div className="row">
                      <button
                        className="text-button"
                        onClick={() => {
                          const r = records.find((r) => r.id === a.event_id);
                          if (r) setSelected(r);
                          else
                            action(async () => {
                              setSelected(
                                await api<Recording>('/events/' + a.event_id),
                              );
                            });
                        }}
                      >
                        View evidence <ArrowUpRight size={14} />
                      </button>
                      {!a.seen && (
                        <button
                          className="quiet"
                          onClick={() =>
                            action(() =>
                              api('/alerts/' + a.id + '/seen', {
                                method: 'POST',
                              }),
                            )
                          }
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <p className="muted">
                  No alerts yet. REWIND will surface a moment here when recorded
                  evidence meets a monitoring request.
                </p>
              )}
            </section>
          </div>
        </TabsContent>
        <TabsContent value="system">
          <div className="system-grid">
            <section className="card">
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
            </section>
            <section className="card">
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
              </dl>
              <div className="row">
                <button
                  className="quiet"
                  disabled={busy || !status?.failed}
                  onClick={() =>
                    action(() => api('/retry', { method: 'POST' }))
                  }
                >
                  <RefreshCw size={16} /> Retry failures
                </button>
                <a
                  className="button-link"
                  href="/api/export"
                  download="rewind-memory.json"
                >
                  <Download size={16} /> Export metadata
                </a>
              </div>
              <p className="meta mt-4">
                Original recordings are never automatically deleted. At the
                storage limit, uploads wait on the necklace.
              </p>
            </section>
          </div>
        </TabsContent>
      </Tabs>
      <footer>
        <span>CAPTURE → OBSERVE → RECALL</span>
        <span className="muted">
          A record, not a guarantee. Occluded moments remain unknown.
        </span>
      </footer>
      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <DialogContent className="evidence-dialog">
          <DialogTitle>Recorded evidence</DialogTitle>
          <DialogDescription>
            {selected
              ? new Date(selected.captured_at * 1000).toLocaleString()
              : ''}{' '}
            ·{' '}
            {selected?.clock_quality === 'received_only'
              ? 'capture time unknown; showing receive time'
              : selected?.device || 'recording'}
          </DialogDescription>
          {selected && (
            <>
              <Media recording={selected} />
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
              <div className="row">
                <a className="button-link" href={selected.media_url} download>
                  Download original
                </a>
                <button
                  className="quiet danger"
                  onClick={() => setDeleting(selected)}
                >
                  <Trash2 size={16} /> Delete recording
                </button>
              </div>
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
                action(async () => {
                  await api('/media/' + deleting!.id, { method: 'DELETE' });
                  setDeleting(null);
                  setSelected(null);
                  setResults(null);
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
function Media({ recording: r }: { recording: Recording }) {
  return r.kind === 'frame' ? (
    <img
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
