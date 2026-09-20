'use client';
/* oxlint-disable next/no-html-link-for-pages -- Static FastAPI export serves full documents and has no RSC prefetch endpoint. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  Aperture,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  Cloud,
  Mic,
  Radio,
  ScanLine,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import Login from '@/components/login';
import {
  api,
  AUTH_REQUIRED_EVENT,
  isAuthenticationError,
  type Answer,
  type Status,
} from '@/lib/api';
import { PhoneCapture, type CaptureState } from '@/lib/phone-capture';
import {
  VoiceClient,
  isReviewedAnswer,
  type Exchange,
  type VoiceState,
} from '@/lib/voice';
import { ComputerPanel } from '@/components/computer-panel';
import { ContextPanel } from '@/components/context-panel';
import { PeoplePanel } from '@/components/people-panel';
import { Orb, type OrbState } from '@/components/dashboard/orb';
import { Card, Cell, hm } from '@/components/dashboard/primitives';
import { SendLetter, type Send } from '@/components/dashboard/letter';
import '@/app/dashboard.css';
import '@/app/mail.css';
import './phone.css';
import { FrameImage } from '@/components/catalog';

type Reminder = {
  id: string;
  message: string;
  seen: number;
  starts_at: number;
};
type OriginalRecording = {
  id: string;
  started_at: number;
  end_reason: string | null;
  original_url: string | null;
  bytes: number;
};
const INITIAL: CaptureState = {
  recording: false,
  requesting: false,
  question: false,
  queued: 0,
  saved: 0,
  error: '',
  awake: false,
  startedAt: 0,
  finalizing: false,
  originalBytes: 0,
  voice: 'off',
  speaking: false,
  speechError: '',
  speechRetryAvailable: false,
  previewing: false,
};
const clean = (text: string) => text.replace(/\[[0-9a-f-]{36}\]/gi, '').trim();

export default function Phone() {
  const video = useRef<HTMLVideoElement>(null);
  const capture = useRef<PhoneCapture | null>(null);
  const voice = useRef<VoiceClient | null>(null);
  const cam = useRef<HTMLDivElement>(null);
  const scanGeneration = useRef(0);
  const scanPending = useRef(false);
  const sendRef = useRef<Send | null>(null);
  const [scanning, setScanning] = useState(false);
  const [send, setSend] = useState<Send | null>(null);
  const [scanNotice, setScanNotice] = useState('');
  const [clock, setClock] = useState('');
  const reduce = useReducedMotion();
  const announced = useRef(new Set<string>());
  const [auth, setAuth] = useState<boolean | null>(null);
  const [state, setState] = useState(INITIAL);
  const [status, setStatus] = useState<Status | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [originals, setOriginals] = useState<OriginalRecording[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [deepgram, setDeepgram] = useState<boolean | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [history, setHistory] = useState<Exchange[]>([]);
  const [lastHeard, setLastHeard] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'record' | 'context' | 'computer'>('record');
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  const authExpired = useRef(false);
  const cancelScanner = useCallback(() => {
    ++scanGeneration.current;
    if (sendRef.current) URL.revokeObjectURL(sendRef.current.photo);
    sendRef.current = null;
  }, []);
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      );
    tick();
    const timer = setInterval(tick, 15000);
    return () => {
      clearInterval(timer);
      cancelScanner();
    };
  }, [cancelScanner]);
  useEffect(() => {
    document.documentElement.classList.toggle('rw-light', auth !== false);
    return () => document.documentElement.classList.remove('rw-light');
  }, [auth]);
  useEffect(() => {
    soundRef.current = sound;
    voice.current?.setMuted(!sound);
  }, [sound]);
  useEffect(() => {
    const requireAuthentication = () => {
      // A stale successful request must never reopen the recorder after a 401.
      authExpired.current = true;
      setAuth(false);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
    return () =>
      window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
  }, []);
  useEffect(() => {
    if (auth === false || authExpired.current) return;
    if (window.location.hash.startsWith('#connect=')) {
      // oxlint-disable-next-line react/react-compiler -- Route an explicit pairing link into its redemption screen.
      setAuth(false);
      return;
    }
    let alive = true;
    let polling = false;
    const requests = new AbortController();
    const poll = async () => {
      if (polling || !alive || authExpired.current) return;
      polling = true;
      try {
        const [next, recent, due, recorded] = await Promise.all([
          api<Status>('/status', { signal: requests.signal }),
          api<Answer[]>('/answers', { signal: requests.signal }),
          api<Reminder[]>('/context/reminders', { signal: requests.signal }),
          api<OriginalRecording[]>('/continuous-recordings?limit=3', {
            signal: requests.signal,
          }),
        ]);
        if (!alive || authExpired.current) return;
        setAuth(true);
        setStatus(next);
        setAnswers(recent);
        setReminders(due);
        setOriginals(recorded);
        setError('');
        for (const reminder of due)
          if (
            !reminder.seen &&
            !announced.current.has(reminder.id) &&
            soundRef.current &&
            voice.current &&
            voice.current.state === 'idle'
          ) {
            announced.current.add(reminder.id);
            void voice.current.say(reminder.message);
          }
      } catch (problem) {
        if (alive && isAuthenticationError(problem)) {
          authExpired.current = true;
          setAuth(false);
        } else if (alive && !requests.signal.aborted && !authExpired.current)
          setError('Connection interrupted. Reconnecting to your memory…');
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
      requests.abort();
    };
  }, [auth]);
  useEffect(() => {
    if (auth !== true || !video.current) return;
    const agent = new VoiceClient();
    voice.current = agent;
    const unsubscribe = agent.subscribe((next, current) => {
      setVoiceState(next);
      if (agent.status) setDeepgram(agent.status.deepgram);
      setExchange(current);
      if (current && next === 'idle' && current.spoken)
        setHistory((previous) =>
          previous[0]?.id === current.id
            ? previous
            : [current, ...previous].slice(0, 6),
        );
    });
    const controller = new PhoneCapture(video.current, setState, {
      onUtterance: (blob) => {
        if (agent.state !== 'idle') return;
        void agent
          .hear(blob, true)
          .then((heard) => {
            if (heard.transcript) setLastHeard(heard.transcript);
            if (heard.directed)
              return agent.ask(heard.question, heard.transcript);
          })
          .catch((problem) =>
            setError(
              problem instanceof Error ? problem.message : String(problem),
            ),
          );
      },
    });
    agent.onSpeaking = (speaking) => controller.suppressListening(speaking);
    capture.current = controller;
    return () => {
      cancelScanner();
      unsubscribe();
      agent.dispose();
      controller.dispose();
      capture.current = null;
      voice.current = null;
    };
  }, [auth, cancelScanner]);
  async function ask(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking || !voice.current) return;
    setAsking(true);
    setError('');
    voice.current.unlock();
    try {
      setQuestion('');
      const result = await voice.current.ask(text);
      if (result.error) setError(result.error);
    } finally {
      setAsking(false);
    }
  }
  function toggleRecording() {
    if (state.recording || state.requesting) {
      ++scanGeneration.current;
      capture.current?.stop();
    } else {
      voice.current?.unlock();
      soundRef.current = true;
      setSound(true);
      void capture.current?.start();
    }
  }
  function changeView(next: 'record' | 'context' | 'computer') {
    if (next !== 'record') {
      cancelScanner();
      setSend(null);
      setScanning(false);
      if (!capture.current?.state.recording) capture.current?.stop();
    }
    setView(next);
  }
  const pageHidden = () => document.visibilityState === 'hidden';
  async function scan() {
    const controller = capture.current;
    if (
      !controller ||
      scanPending.current ||
      sendRef.current ||
      authExpired.current
    )
      return;
    const generation = ++scanGeneration.current;
    scanPending.current = true;
    setScanning(true);
    setScanNotice('');
    try {
      if (
        !(controller.state.recording || controller.state.previewing) &&
        !(await controller.preview())
      )
        return;
      if (
        generation !== scanGeneration.current ||
        capture.current !== controller ||
        authExpired.current
      )
        return;
      const shot = await controller.snap();
      if (!shot) return;
      // The image is already durable in IndexedDB. The animation means queued,
      // never server-saved: the actual server count comes only from /status.
      if (
        generation !== scanGeneration.current ||
        capture.current !== controller ||
        authExpired.current ||
        pageHidden()
      ) {
        URL.revokeObjectURL(shot.url);
        return;
      }
      setScanNotice('Reading your mail… it will appear on the home screen.');
      const from = cam.current?.getBoundingClientRect();
      if (!from) {
        URL.revokeObjectURL(shot.url);
        return;
      }
      if (!reduce) await new Promise((resolve) => setTimeout(resolve, 350));
      if (
        generation !== scanGeneration.current ||
        capture.current !== controller ||
        authExpired.current ||
        pageHidden()
      ) {
        URL.revokeObjectURL(shot.url);
        return;
      }
      const next = { id: Date.now(), photo: shot.url, from };
      sendRef.current = next;
      setSend(next);
    } finally {
      scanPending.current = false;
      if (capture.current === controller && !authExpired.current)
        setScanning(false);
    }
  }
  function sendDone(id: number) {
    if (sendRef.current?.id !== id) return;
    URL.revokeObjectURL(sendRef.current.photo);
    sendRef.current = null;
    setSend(null);
  }
  const voiceLabel =
    voiceState === 'speaking'
      ? 'Speaking…'
      : voiceState === 'thinking'
        ? 'Looking through your day…'
        : voiceState === 'hearing'
          ? 'Heard you, one moment…'
          : state.voice === 'hearing'
            ? 'I’m listening…'
            : state.recording && state.voice === 'listening'
              ? 'Say “Rewind” and then your question'
              : state.voice === 'unavailable'
                ? 'Voice unavailable · type below'
                : 'Press Record, then say “Rewind, …”';
  const orb: OrbState =
    voiceState === 'speaking'
      ? 'answer'
      : voiceState === 'thinking' || voiceState === 'hearing' || asking
        ? 'thinking'
        : state.voice === 'hearing'
          ? 'listening'
          : 'idle';
  const cameraOn = state.recording || state.previewing;
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const zone = status?.timezone;
  if (auth === false) return <Login />;
  if (auth === null)
    return (
      <div className="rw ph">
        <main className="ph-page ph-wait">
          <span className="rw-brand-mark ph-wait-mark">
            <Aperture />
          </span>
          <p>{error || 'Connecting to your memory…'}</p>
        </main>
      </div>
    );
  return (
    <div className="rw ph">
      <div className="ph-sheet">
        <header className="ph-top">
          <a href="/" className="rw-brand" aria-label="Open workspace">
            <span className="rw-brand-mark">
              <Aperture />
            </span>
            rewind<span className="rw-brand-period">.</span>
            <span className="rw-brand-time">{clock}</span>
          </a>
          <span className="ph-memory" title="Items saved on the server">
            <Cloud />
            <b className="tabular">{status?.received ?? 0}</b>
            <span className="sr-only"> saved items</span>
          </span>
        </header>
        <main className="ph-page mode-rose">
          <nav className="phone-tabs" aria-label="Phone workspace">
            <button
              type="button"
              className={view === 'record' ? 'selected' : ''}
              aria-pressed={view === 'record'}
              onClick={() => changeView('record')}
            >
              Your day
            </button>
            <button
              type="button"
              className={view === 'context' ? 'selected' : ''}
              aria-pressed={view === 'context'}
              onClick={() => changeView('context')}
            >
              Your connections
            </button>
            <button
              type="button"
              className={view === 'computer' ? 'selected' : ''}
              aria-pressed={view === 'computer'}
              onClick={() => changeView('computer')}
            >
              Your computer
            </button>
          </nav>
          {(state.error || error) && (
            <div className="rw-banner" role="alert">
              {state.error || error}
            </div>
          )}
          <section hidden={view !== 'record'}>
            <div className="greeting">
              <h1>{greet}.</h1>
              <p>
                {state.recording
                  ? `Recording your day${state.startedAt ? ` since ${hm(state.startedAt / 1000, zone)}` : ''}.`
                  : 'Tap Record, clip your phone on, and leave this screen open.'}
              </p>
            </div>
            {reminders
              .filter((reminder) => !reminder.seen)
              .map((reminder) => (
                <Cell key={reminder.id} label="Up next" index={0}>
                  <Card className="card-next">
                    <div className="row">
                      <strong className="big-time">
                        {hm(reminder.starts_at, zone)}
                      </strong>
                      <button
                        type="button"
                        className="tbtn"
                        aria-label="Dismiss reminder"
                        onClick={() => {
                          void api(
                            '/context/reminders/' + reminder.id + '/seen',
                            { method: 'POST' },
                          )
                            .then(() =>
                              setReminders((rows) =>
                                rows.filter((r) => r.id !== reminder.id),
                              ),
                            )
                            .catch(() =>
                              setError(
                                'Could not dismiss this reminder. Try again.',
                              ),
                            );
                        }}
                      >
                        <Check />
                      </button>
                    </div>
                    <p className="next-text">{reminder.message}</p>
                  </Card>
                </Cell>
              ))}
            <Cell label="Your view" index={1}>
              <Card
                className={`card-media ${state.recording ? 'is-rec' : ''} ${cameraOn ? 'is-on' : ''} ${scanning ? 'is-scanning' : ''}`}
              >
                <div className="cam" ref={cam}>
                  <video
                    ref={video}
                    muted
                    playsInline
                    aria-label="Live camera preview"
                  />
                  {!cameraOn && (
                    <span className="ph-camera-placeholder">
                      <Camera />
                      <span>Your view, remembered.</span>
                    </span>
                  )}
                  <span className="sweep" aria-hidden="true" />
                </div>
                <div className="media-foot">
                  <span className="media-title">
                    {state.recording
                      ? 'Recording'
                      : state.finalizing
                        ? 'Saving last seconds…'
                        : state.previewing
                          ? 'Camera on'
                          : 'Your view'}
                    <small>
                      {state.queued
                        ? `${state.queued} waiting to upload`
                        : state.saved
                          ? `${state.saved} uploads complete`
                          : 'Nothing uploaded this session'}
                    </small>
                  </span>
                  <span className="media-ctl">
                    {(state.previewing || state.requesting) &&
                    !state.recording ? (
                      <button
                        type="button"
                        className="gbtn gbtn-round"
                        aria-label="Close camera"
                        onClick={() => {
                          ++scanGeneration.current;
                          capture.current?.stop();
                        }}
                      >
                        <X />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="gbtn gbtn-round"
                        aria-label="Open camera"
                        disabled={state.recording || state.finalizing}
                        onClick={() => void capture.current?.preview()}
                      >
                        <Camera />
                      </button>
                    )}
                  </span>
                </div>
              </Card>
              <button
                type="button"
                className={`btn phone-record-button ${state.recording ? 'active' : ''}`}
                disabled={state.requesting || state.finalizing}
                onClick={toggleRecording}
              >
                {state.recording ? <Square fill="currentColor" /> : <Radio />}
                {state.requesting
                  ? 'Opening camera…'
                  : state.finalizing
                    ? 'Saving last seconds…'
                    : state.recording
                      ? 'Stop recording'
                      : 'Record'}
              </button>
              <button
                type="button"
                className="btn scan-btn"
                disabled={
                  scanning || !!send || state.requesting || state.finalizing
                }
                onClick={() => void scan()}
              >
                <ScanLine />
                {scanning ? 'Scanning…' : 'Scan mail'}
              </button>
              {scanNotice && (
                <output className="phone-fine ph-scan-notice">
                  {scanNotice}
                </output>
              )}
              <div className="phone-capture-details">
                <span>
                  {state.recording
                    ? state.awake
                      ? 'Screen stays awake'
                      : 'Keep your screen awake'
                    : state.previewing
                      ? 'Hold a letter or bill in view, then tap Scan mail'
                      : 'Camera is off'}
                </span>
              </div>
              <p className="phone-fine">
                Record saves full video and audio while this page stays open.{' '}
                {status?.analysis_ready === false
                  ? 'Analysis is waiting for the ASUS model; saved uploads will wait.'
                  : status?.pending
                    ? `${status.pending} moments are waiting to be looked at.`
                    : 'Scan a postcard or a bill and it files itself at home.'}
              </p>
              {originals.some((recording) => recording.original_url) && (
                <details className="phone-fine ph-originals">
                  <summary>Saved full recordings</summary>
                  {originals
                    .filter((recording) => recording.original_url)
                    .map((recording) => (
                      <p key={recording.id}>
                        <a
                          href={recording.original_url!}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open original from {hm(recording.started_at, zone)}
                        </a>{' '}
                        ({(recording.bytes / 1024 / 1024).toFixed(1)} MB)
                        {recording.end_reason !== 'stopped'
                          ? ' · interrupted recording'
                          : ''}
                      </p>
                    ))}
                </details>
              )}
            </Cell>
            <Cell label="Talk to Rewind" index={2}>
              <Card className="card-dark card-ask" data-state={orb}>
                <div className="row">
                  <span className="card-title">Just say “Rewind”.</span>
                  <button
                    type="button"
                    className={`dim ask-sound ${sound ? 'is-on' : ''}`}
                    aria-pressed={sound}
                    aria-label="Spoken answers and reminders"
                    onClick={() => {
                      if (!sound) voice.current?.unlock();
                      setSound(!sound);
                    }}
                  >
                    {sound ? <Volume2 /> : <VolumeX />}
                  </button>
                </div>
                <div className="orb-stage" aria-hidden="true">
                  <Orb state={orb} size={150} />
                  <div className="waves">
                    {[3, 1, 4, 0, 2, 5, 3].map((n, i) => (
                      <i key={i} style={{ '--n': n } as React.CSSProperties} />
                    ))}
                  </div>
                </div>
                <output className="ph-voice-status" aria-live="polite">
                  <Mic />
                  {voiceLabel}
                </output>
                <div className="ask-body">
                  {exchange ? (
                    <div className="ph-exchange">
                      <p className="ph-heard">“{exchange.heard}”</p>
                      <p className="ph-spoken">
                        {exchange.spoken ||
                          (voiceState === 'thinking' ? 'Let me look…' : '')}
                      </p>
                    </div>
                  ) : (
                    <p className="hint">
                      {lastHeard
                        ? `Heard “${lastHeard}”. Start with “Rewind” when you want an answer.`
                        : 'Try: “Rewind, where did I leave my glasses?” or “Rewind, when is my doctor’s bill due?”'}
                    </p>
                  )}
                </div>
                <form className="ask-bar" autoComplete="off" onSubmit={ask}>
                  <label className={`ask-input ${question ? 'has-text' : ''}`}>
                    <input
                      aria-label="Type a question"
                      placeholder="Or type a question…"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      maxLength={2000}
                    />
                    <button
                      type="submit"
                      className="send"
                      aria-label="Send question"
                      disabled={asking || !question.trim()}
                    >
                      <ArrowUp />
                    </button>
                  </label>
                </form>
                {deepgram === false && (
                  <p className="phone-fine ph-voice-note">
                    Voice replies use this phone’s built-in voice until a
                    Deepgram key is added on the server.
                  </p>
                )}
              </Card>
              {history.map((item) => (
                <article className="phone-answer" key={item.id}>
                  <h3>{item.heard}</h3>
                  <p>{item.spoken}</p>
                  {item.answer?.evidence.slice(0, 2).map((source) => (
                    <details key={source.id}>
                      <summary>
                        {source.title || source.summary || 'What I saw'}
                      </summary>
                      {source.source === 'notch' ? (
                        <p>{source.text}</p>
                      ) : source.kind === 'frame' ? (
                        <FrameImage
                          src={source.media_url}
                          alt={source.summary || 'Recorded evidence'}
                        />
                      ) : (
                        <audio controls src={source.media_url}>
                          <track kind="captions" />
                        </audio>
                      )}
                    </details>
                  ))}
                  <div>
                    <small>
                      {item.error
                        ? item.error
                        : item.answer
                          ? `${item.answer.evidence.length} moments`
                          : ''}
                    </small>
                    <button
                      aria-label="Read answer aloud"
                      disabled={
                        !item.spoken ||
                        (!!item.answer && !isReviewedAnswer(item.answer))
                      }
                      onClick={() => {
                        voice.current?.unlock();
                        void voice.current?.say(item.spoken);
                      }}
                    >
                      <Volume2 size={18} />
                    </button>
                  </div>
                </article>
              ))}
              {!history.length &&
                answers.slice(0, 2).map((answer) => (
                  <article className="phone-answer" key={answer.id}>
                    <h3>{answer.question}</h3>
                    <p>{clean(answer.answer).split('\n\n')[0]}</p>
                    <div>
                      <small>
                        {answer.grounded
                          ? `${answer.evidence.length} moments`
                          : 'Not enough to be sure'}
                      </small>
                      <button
                        aria-label="Read answer aloud"
                        disabled={!isReviewedAnswer(answer)}
                        onClick={() => {
                          voice.current?.unlock();
                          void voice.current?.say(clean(answer.answer));
                        }}
                      >
                        <Volume2 size={18} />
                      </button>
                    </div>
                  </article>
                ))}
            </Cell>
          </section>
          <section hidden={view !== 'context'} className="ph-panels">
            <ContextPanel />
            <PeoplePanel />
          </section>
          <section hidden={view !== 'computer'} className="ph-panels">
            <ComputerPanel visible={view === 'computer'} />
          </section>
          <footer className="phone-footer">
            <a href="/">
              <ArrowLeft size={14} />
              Open your workspace
            </a>
            <a href="/print" target="_blank" rel="noreferrer">
              Print the demo mail
            </a>
          </footer>
        </main>
      </div>
      <SendLetter send={send} onDone={sendDone} />
    </div>
  );
}
