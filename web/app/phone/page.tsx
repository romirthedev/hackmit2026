'use client';
/* oxlint-disable next/no-img-element, jsx-a11y/media-has-caption -- evidence originals come straight from the local server */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  Aperture,
  ArrowUp,
  Camera,
  Check,
  Cloud,
  Mic,
  ScanLine,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import Login from '@/components/login';
import { api, type Answer, type Status } from '@/lib/api';
import {
  PhoneCapture,
  type CaptureState,
  type Snapshot,
} from '@/lib/phone-capture';
import { Orb, type OrbState } from '@/components/dashboard/orb';
import { Card, Cell, hm } from '@/components/dashboard/primitives';
import { SendLetter, type Send } from '@/components/dashboard/letter';
import { demoPhoto } from '@/components/phone/demo-photo';
import '@/app/dashboard.css';
import './phone.css';

type Reminder = {
  id: string;
  message: string;
  seen: number;
  starts_at: number;
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
  previewing: false,
};
const clean = (text: string) => text.replace(/\[[0-9a-f-]{36}\]/g, '').trim();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Phone() {
  const video = useRef<HTMLVideoElement>(null);
  const cam = useRef<HTMLDivElement>(null);
  const capture = useRef<PhoneCapture | null>(null);
  const announced = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();
  const [auth, setAuth] = useState<boolean | null>(null);
  const [state, setState] = useState(INITIAL);
  const [status, setStatus] = useState<Status | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [fresh, setFresh] = useState<Answer | null>(null);
  const [error, setError] = useState('');
  const [sound, setSound] = useState(false);
  const [clock, setClock] = useState('');
  // Scan hand-off
  const [scanning, setScanning] = useState(false);
  const [send, setSend] = useState<Send | null>(null);
  const [sent, setSent] = useState(0);
  const soundRef = useRef(false);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    document.documentElement.classList.add('rw-light');
    const f = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      );
    f();
    const t = setInterval(f, 15000);
    const pending = timers.current;
    return () => {
      clearInterval(t);
      pending.forEach(clearTimeout);
      document.documentElement.classList.remove('rw-light');
    };
  }, []);
  useEffect(() => {
    if (window.location.hash.startsWith('#connect=')) {
      // oxlint-disable-next-line react/react-compiler -- Route an explicit pairing link into its redemption screen.
      setAuth(false);
      return;
    }
    let alive = true;
    let first = true;
    const poll = async () => {
      try {
        const [next, recent, due] = await Promise.all([
          api<Status>('/status'),
          api<Answer[]>('/answers'),
          api<Reminder[]>('/context/reminders'),
        ]);
        if (!alive) return;
        setAuth(true);
        setStatus(next);
        setAnswers(recent);
        setReminders(due);
        setError('');
        for (const reminder of due)
          if (!reminder.seen && !announced.current.has(reminder.id)) {
            if (soundRef.current && !capture.current?.state.question) {
              capture.current?.speak(reminder.message);
              announced.current.add(reminder.id);
            }
          }
        if (
          !first &&
          recent[0] &&
          recent[0].mode !== 'checking' &&
          !announced.current.has(recent[0].id) &&
          soundRef.current &&
          !capture.current?.state.question
        )
          capture.current?.speak(recent[0].answer);
        recent
          .filter((answer) => answer.mode !== 'checking')
          .forEach((answer) => announced.current.add(answer.id));
        first = false;
      } catch (problem) {
        if (alive && /access key|401/.test(String(problem))) setAuth(false);
        else if (alive) setError('Reconnecting to your memory…');
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const received = status?.received;
  useEffect(() => {
    // The server count catches up with what the phone already showed.
    // oxlint-disable-next-line react/react-compiler -- reset the optimistic offset
    setSent(0);
  }, [received]);
  useEffect(() => {
    if (auth !== true || !video.current) return;
    const controller = new PhoneCapture(video.current, setState);
    capture.current = controller;
    return () => {
      controller.dispose();
      capture.current = null;
    };
  }, [auth]);

  const later = (fn: () => void, ms: number) =>
    timers.current.push(setTimeout(fn, ms));
  function showAnswer(answer: Answer) {
    setFresh(answer);
    later(() => setFresh((f) => (f?.id === answer.id ? null : f)), 20000);
  }
  async function ask(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setError('');
    try {
      const answer = await api<Answer>('/ask', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setAnswers((previous) => [
        answer,
        ...previous.filter((old) => old.id !== answer.id),
      ]);
      setQuestion('');
      showAnswer(answer);
      if (answer.mode !== 'checking') {
        if (sound) capture.current?.speak(answer.answer);
        announced.current.add(answer.id);
      }
    } catch (problem) {
      setError(String(problem).replace(/^Error: /, ''));
    } finally {
      setAsking(false);
    }
  }
  // Tap the orb: start recording if needed, then take a spoken question.
  async function talk() {
    const c = capture.current;
    if (!c) return;
    if (!c.state.recording) {
      await c.start();
      if (!c.state.recording) return;
    }
    c.toggleQuestion();
  }
  // Scan: a short sweep over the view, then the photo is folded into a
  // letter that floats up into the cloud. Uses the real camera when it can
  // (opening it on first use); a plain generated card only if no camera
  // is available. Nothing here depends on the backend beyond the existing
  // frame upload.
  async function scan() {
    const c = capture.current;
    if (!c || scanning || send) return;
    setScanning(true);
    const t0 = Date.now();
    if (!c.state.recording && !c.state.previewing) await c.preview();
    let shot: Snapshot | null = null;
    if (c.state.recording || c.state.previewing) {
      await wait(250);
      shot = await c.snap();
    }
    if (!shot) {
      const demo = await demoPhoto();
      c.send(demo.blob);
      shot = demo;
    }
    await wait(Math.max(0, (reduce ? 50 : 950) - (Date.now() - t0)));
    setScanning(false);
    const from = cam.current?.getBoundingClientRect();
    if (!from) return;
    setSend({ id: Date.now(), photo: shot.url, from });
  }
  function sendDone(id: number) {
    setSend((f) => {
      if (f?.id === id) URL.revokeObjectURL(f.photo);
      return f?.id === id ? null : f;
    });
    setSent((n) => n + 1);
  }

  const orb: OrbState = state.question
    ? 'listening'
    : asking
      ? 'thinking'
      : fresh
        ? 'answer'
        : 'idle';
  const zone = status?.timezone;
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const cameraOn = state.recording || state.previewing;
  const due = reminders.find((r) => !r.seen);
  const frames = fresh?.evidence.filter((e) => e.kind === 'frame') ?? [];

  if (auth === false) return <Login />;
  if (auth === null)
    return (
      <div className="rw ph">
        <main className="ph-page ph-wait">
          <span className="rw-brand-mark ph-wait-mark">
            <Aperture />
          </span>
          <p>{error || 'Opening your memory…'}</p>
        </main>
      </div>
    );
  return (
    <div className="rw ph">
      <div className="ph-sheet">
        <header className="ph-top">
          <span className="rw-brand">
            <span className="rw-brand-mark">
              <Aperture />
            </span>
            rewind<span className="rw-brand-period">.</span>
            <span className="rw-brand-time">{clock}</span>
          </span>
          <span className="ph-memory">
            <Cloud />
            <b className="tabular">{(status?.received || 0) + sent}</b>
          </span>
        </header>

        <main className="ph-page mode-rose">
          <div className="greeting">
            <h1>{greet}, Rose</h1>
            <p>
              {state.recording
                ? `Remembering your day${state.startedAt ? ` since ${hm(state.startedAt / 1000, zone)}` : ''}.`
                : 'Point me at something and tap Scan.'}
            </p>
          </div>

          {(state.error || error) && (
            <div className="rw-banner" role="alert">
              <span>{state.error || error}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setError('')}
              >
                <X />
              </button>
            </div>
          )}

          {due && (
            <Cell label="Up next" index={0}>
              <Card className="card-next">
                <div className="row">
                  <div className="big-time">
                    {new Date(due.starts_at * 1000)
                      .toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                        timeZone: zone,
                      })
                      .replace(/\s?(AM|PM)$/i, '')}
                    <span>
                      {new Date(due.starts_at * 1000)
                        .toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          hour12: true,
                          timeZone: zone,
                        })
                        .replace(/^[\d:]+\s?/, '')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="tbtn"
                    aria-label="Got it"
                    onClick={() => {
                      void api('/context/reminders/' + due.id + '/seen', {
                        method: 'POST',
                      })
                        .then(() =>
                          setReminders((rows) =>
                            rows.filter((r) => r.id !== due.id),
                          ),
                        )
                        .catch(() =>
                          setError('Could not dismiss this reminder.'),
                        );
                    }}
                  >
                    <Check />
                  </button>
                </div>
                <p className="next-text">{due.message}</p>
              </Card>
            </Cell>
          )}

          <Cell label="Your view" index={1}>
            <Card
              className={`card-media ${state.recording ? 'is-rec' : ''} ${cameraOn ? 'is-on' : ''} ${scanning ? 'is-scanning' : ''}`}
            >
              <div className="cam" ref={cam}>
                <video ref={video} muted playsInline aria-label="Camera" />
                <span className="sweep" aria-hidden="true" />
              </div>
              <div className="media-foot">
                <span className="media-title">
                  {state.recording
                    ? 'Recording'
                    : state.finalizing
                      ? 'Saving…'
                      : state.previewing
                        ? 'Camera on'
                        : 'Your view'}
                  <small>
                    {state.queued
                      ? `${state.queued} sending`
                      : state.saved
                        ? `${state.saved} saved`
                        : 'Nothing saved yet'}
                  </small>
                </span>
                <span className="media-ctl">
                  {state.previewing ? (
                    <button
                      type="button"
                      className="gbtn gbtn-round"
                      aria-label="Close camera"
                      onClick={() => capture.current?.stopPreview()}
                    >
                      <X />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="gbtn gbtn-round"
                      aria-label="Open camera"
                      disabled={state.requesting || state.recording}
                      onClick={() => void capture.current?.preview()}
                    >
                      <Camera />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`gbtn gbtn-round ${state.recording ? 'is-rec' : ''}`}
                    aria-label={state.recording ? 'Stop recording' : 'Record'}
                    disabled={state.requesting || state.finalizing}
                    onClick={() => {
                      if (state.recording) capture.current?.stop();
                      else void capture.current?.start();
                    }}
                  >
                    {state.recording ? <Square /> : <i className="rec-dot" />}
                  </button>
                </span>
              </div>
            </Card>
            <button
              type="button"
              className="btn scan-btn"
              disabled={scanning || !!send || state.requesting}
              onClick={() => void scan()}
            >
              <ScanLine />
              {scanning ? 'Scanning' : 'Scan'}
            </button>
          </Cell>

          <Cell label="Ask Rewind" index={2}>
            <Card className="card-dark card-ask" data-state={orb}>
              <div className="row">
                <span className="card-title">Ask</span>
                <span className="row ask-tools">
                  <button
                    type="button"
                    className={`dim ask-sound ${sound ? 'is-on' : ''}`}
                    aria-pressed={sound}
                    aria-label="Read answers aloud"
                    onClick={() => setSound(!sound)}
                  >
                    {sound ? <Volume2 /> : <VolumeX />}
                  </button>
                  <span className="dim">
                    <span className="live" />
                    {orb === 'listening'
                      ? 'Listening'
                      : orb === 'thinking'
                        ? 'Thinking'
                        : orb === 'answer'
                          ? 'Rewind'
                          : 'Ready'}
                  </span>
                </span>
              </div>
              <button
                type="button"
                className="orb-stage"
                onClick={() => void talk()}
                aria-label={state.question ? 'Done asking' : 'Tap to ask aloud'}
                disabled={state.requesting}
              >
                <Orb state={orb} size={150} />
                <div className="waves" aria-hidden="true">
                  {[3, 1, 4, 0, 2, 5, 3].map((n, i) => (
                    <i key={i} style={{ '--n': n } as React.CSSProperties} />
                  ))}
                </div>
              </button>
              <div className="ask-body">
                {fresh ? (
                  <>
                    <p className="answer">{clean(fresh.answer)}</p>
                    {frames.length > 0 && (
                      <div className="stack ask-stack">
                        {frames.slice(0, 4).map((f) => (
                          <img key={f.id} src={f.media_url} alt="" />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="hint">
                    {state.question
                      ? 'Go ahead, I\u2019m listening. Tap the orb when you\u2019re done.'
                      : asking
                        ? 'Looking through your moments…'
                        : 'Tap the orb and ask, or type below.'}
                  </p>
                )}
              </div>
              <form className="ask-bar" autoComplete="off" onSubmit={ask}>
                <button
                  type="button"
                  className="gbtn gbtn-round"
                  onClick={() => void talk()}
                  aria-label={state.question ? 'Done asking' : 'Ask aloud'}
                >
                  {state.question ? <Square /> : <Mic />}
                </button>
                <label className={`ask-input ${question ? 'has-text' : ''}`}>
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Where are my glasses?"
                    aria-label="Ask about your day"
                    maxLength={2000}
                  />
                  <button
                    type="submit"
                    className="send"
                    aria-label="Send"
                    disabled={asking || !question.trim()}
                  >
                    <ArrowUp />
                  </button>
                </label>
              </form>
            </Card>
            {answers.length > 0 && !fresh && (
              <button
                type="button"
                className="text-btn last-answer"
                onClick={() => showAnswer(answers[0])}
              >
                Last answer · {hm(answers[0].created_at, zone)}
              </button>
            )}
          </Cell>
        </main>
      </div>

      <SendLetter send={send} onDone={sendDone} />
    </div>
  );
}
