'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  Camera,
  Check,
  Mic,
  Radio,
  Square,
  Volume2,
} from 'lucide-react';
import Login from '@/components/login';
import { api, type Answer, type Status } from '@/lib/api';
import { PhoneCapture, type CaptureState } from '@/lib/phone-capture';
import { ContextPanel } from '@/components/context-panel';
import './phone.css';
import Link from 'next/link';
import { FrameImage } from '@/components/catalog';

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
};
export default function Phone() {
  const video = useRef<HTMLVideoElement>(null);
  const capture = useRef<PhoneCapture | null>(null);
  const announced = useRef(new Set<string>());
  const [auth, setAuth] = useState<boolean | null>(null);
  const [state, setState] = useState(INITIAL);
  const [status, setStatus] = useState<Status | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'record' | 'context'>('record');
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
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
          !announced.current.has(recent[0].id) &&
          soundRef.current &&
          !capture.current?.state.question
        )
          capture.current?.speak(recent[0].answer);
        recent.forEach((answer) => announced.current.add(answer.id));
        first = false;
      } catch (problem) {
        if (alive && /access key|401/.test(String(problem))) setAuth(false);
        else if (alive)
          setError('Connection interrupted. Reconnecting to your memory…');
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (auth !== true || !video.current) return;
    const controller = new PhoneCapture(video.current, setState);
    capture.current = controller;
    return () => {
      controller.dispose();
      capture.current = null;
    };
  }, [auth]);
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
      if (sound) capture.current?.speak(answer.answer);
      announced.current.add(answer.id);
    } catch (problem) {
      setError(String(problem));
    } finally {
      setAsking(false);
    }
  }
  if (auth === false) return <Login />;
  if (auth === null)
    return (
      <main className="phone-shell">
        <p>{error || 'Connecting to your memory…'}</p>
      </main>
    );
  return (
    <main className="phone-shell">
      <header className="phone-header">
        <Link href="/" aria-label="Open workspace">
          <ArrowLeft size={19} />
        </Link>
        <span className="phone-wordmark">
          rewind<span> × notch</span>
        </span>
        <button
          className={sound ? 'sound-on' : ''}
          aria-pressed={sound}
          aria-label="Spoken answers and reminders"
          onClick={() => setSound(!sound)}
        >
          <Volume2 size={20} />
        </button>
      </header>
      <nav className="phone-tabs">
        <button
          className={view === 'record' ? 'selected' : ''}
          onClick={() => setView('record')}
        >
          Your day
        </button>
        <button
          className={view === 'context' ? 'selected' : ''}
          onClick={() => setView('context')}
        >
          Your connections
        </button>
      </nav>
      <section className="phone-record-view" hidden={view !== 'record'}>
        <div className="phone-intro">
          <span className="phone-eyebrow">A LITTLE HELP REMEMBERING</span>
          <h1>
            Go about your day.
            <br />
            <em>I’ll keep the moments.</em>
          </h1>
          <p>
            Tap Record, clip your phone to your chest, and leave this screen
            open.
          </p>
        </div>
        {reminders
          .filter((r) => !r.seen)
          .map((reminder) => (
            <aside className="phone-reminder" key={reminder.id}>
              <Bell size={22} />
              <div>
                <strong>Coming up</strong>
                <p>{reminder.message}</p>
              </div>
              <button
                aria-label="Dismiss reminder"
                onClick={() => {
                  void api('/context/reminders/' + reminder.id + '/seen', {
                    method: 'POST',
                  })
                    .then(() =>
                      setReminders((rows) =>
                        rows.filter((r) => r.id !== reminder.id),
                      ),
                    )
                    .catch(() =>
                      setError('Could not dismiss this reminder. Try again.'),
                    );
                }}
              >
                <Check size={19} />
              </button>
            </aside>
          ))}
        <div
          className={'phone-camera ' + (state.recording ? 'is-recording' : '')}
        >
          <video
            ref={video}
            muted
            playsInline
            aria-label="Live camera preview"
          />
          {!state.recording && (
            <div className="phone-camera-empty">
              <Camera size={34} />
              <span>Your view, remembered.</span>
            </div>
          )}
          <span className="phone-camera-status">
            <i />
            {state.recording ? 'Recording your day' : 'Camera is off'}
          </span>
        </div>
        <button
          className={'phone-record-button ' + (state.recording ? 'active' : '')}
          disabled={state.requesting}
          onClick={() => {
            if (state.recording) capture.current?.stop();
            else void capture.current?.start();
          }}
        >
          {state.recording ? (
            <Square size={23} fill="currentColor" />
          ) : (
            <Radio size={26} />
          )}
          {state.requesting
            ? 'Opening camera…'
            : state.recording
              ? 'Stop recording'
              : 'Record'}
        </button>
        <div className="phone-capture-details">
          <span>
            {state.queued
              ? `${state.queued} waiting to upload`
              : `${state.saved} saved this session`}
          </span>
          <span>
            {state.recording
              ? state.awake
                ? 'Screen stays awake'
                : 'Keep your screen awake'
              : 'Ready when you are'}
          </span>
        </div>
        <p className="phone-fine">
          Captures one frame each second and short audio clips.{' '}
          {status?.pending
            ? `${status.pending} recordings are being analyzed.`
            : 'Ask about what has been recorded and your connected sources.'}
        </p>
        {(state.error || error) && (
          <p className="phone-error" role="alert">
            {state.error || error}
          </p>
        )}
        <section className="phone-ask">
          <h2>A question on your mind?</h2>
          <button
            className={'phone-voice ' + (state.question ? 'listening' : '')}
            disabled={!state.recording}
            onClick={() => capture.current?.toggleQuestion()}
          >
            {state.question ? <Square size={19} /> : <Mic size={21} />}
            {state.question ? 'Done — answer my question' : 'Ask aloud'}
          </button>
          {!state.recording && (
            <p className="phone-fine">
              Start recording to ask aloud, or type below.
            </p>
          )}
          <form onSubmit={ask}>
            <input
              aria-label="Ask about your day"
              placeholder="Where did I leave my glasses?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={2000}
            />
            <button
              aria-label="Send question"
              disabled={asking || !question.trim()}
            >
              <ArrowUp size={22} />
            </button>
          </form>
          {asking && (
            <output>Looking through your moments and connections…</output>
          )}
          {answers.slice(0, 3).map((answer) => (
            <article className="phone-answer" key={answer.id}>
              <h3>{answer.question}</h3>
              <p>{answer.answer.replace(/\[[0-9a-f-]{36}\]/g, '')}</p>
              <div>
                <small>
                  {answer.grounded
                    ? `${answer.evidence.length} sources cited`
                    : 'Evidence incomplete'}
                </small>
                <button
                  aria-label="Read answer aloud"
                  onClick={() => capture.current?.speak(answer.answer)}
                >
                  <Volume2 size={18} />
                </button>
              </div>
              {answer.evidence.map((source) => (
                <details key={source.id}>
                  <summary>
                    {source.title || source.summary || source.kind}
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
            </article>
          ))}
        </section>
      </section>
      <section hidden={view !== 'context'}>
        <ContextPanel />
      </section>
      <footer className="phone-footer">
        Your moments. Your people. All connected.
      </footer>
    </main>
  );
}
