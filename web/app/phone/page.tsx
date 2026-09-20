'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
import {
  api,
  AUTH_REQUIRED_EVENT,
  isAuthenticationError,
  type Answer,
  type Status,
  type ConversationState,
} from '@/lib/api';
import { PhoneCapture, type CaptureState } from '@/lib/phone-capture';
import { ComputerPanel } from '@/components/computer-panel';
import { ContextPanel } from '@/components/context-panel';
import { PeoplePanel } from '@/components/people-panel';
import './phone.css';
import Link from 'next/link';
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
  const [originals, setOriginals] = useState<OriginalRecording[]>([]);
  const [conversation, setConversation] = useState<ConversationState>({
    status: 'listening',
    turns: [],
  });
  const [conversationError, setConversationError] = useState('');
  const spokenTurns = useRef(new Set<string>());
  const answerFetchVersion = useRef(0);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'record' | 'context' | 'computer'>('record');
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const authExpired = useRef(false);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    const requireAuthentication = () => {
      // A stale successful request must never reopen the recorder after a 401.
      // Login reloads the page after a successful pairing, resetting this latch.
      authExpired.current = true;
      ++answerFetchVersion.current;
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
        const answerVersion = ++answerFetchVersion.current;
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
        if (answerVersion === answerFetchVersion.current) setAnswers(recent);
        setReminders(due);
        setOriginals(recorded);
        setError('');
        for (const reminder of due)
          if (!reminder.seen && !announced.current.has(reminder.id)) {
            if (soundRef.current && !capture.current?.state.question) {
              capture.current?.speak(reminder.message);
              announced.current.add(reminder.id);
            }
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
    const controller = new PhoneCapture(video.current, setState);
    capture.current = controller;
    return () => {
      controller.dispose();
      capture.current = null;
    };
  }, [auth]);
  useEffect(() => {
    if (auth !== true) return;
    let alive = true;
    let polling = false;
    let first = true;
    const requests = new AbortController();
    const poll = async () => {
      if (polling || !alive || authExpired.current) return;
      polling = true;
      try {
        const next = await api<ConversationState>('/conversation/state', {
          signal: requests.signal,
        });
        if (!alive || authExpired.current) return;
        setConversation(next);
        setConversationError('');
        const newCompletedRecall =
          !first &&
          next.turns.some(
            (turn) =>
              turn.status === 'completed' &&
              turn.answer_id &&
              !spokenTurns.current.has(`${turn.id}:${turn.response_revision}`),
          );
        let refreshedAnswers: Answer[] = [];
        if (newCompletedRecall) {
          ++answerFetchVersion.current;
          refreshedAnswers = await api<Answer[]>('/answers', {
            signal: requests.signal,
          });
          if (!alive || authExpired.current) return;
          // Invalidate slower dashboard polls so a draft cannot replace the
          // checked card while its completed response is being spoken.
          ++answerFetchVersion.current;
          // Commit the checked label before handing the response to speech.
          flushSync(() => setAnswers(refreshedAnswers));
        }
        for (const turn of [...next.turns].sort(
          (a, b) => a.created_at - b.created_at,
        )) {
          if (
            turn.transcript &&
            ['thinking', 'checking'].includes(turn.status)
          ) {
            const acknowledgement = `${turn.id}:ack`;
            if (
              !first &&
              !spokenTurns.current.has(acknowledgement) &&
              soundRef.current
            )
              capture.current?.speak('Let me check that.');
            spokenTurns.current.add(acknowledgement);
          }
          if (
            !turn.response ||
            ![
              'completed',
              'clarification',
              'awaiting_permission',
              'error',
            ].includes(turn.status)
          )
            continue;
          const key = `${turn.id}:${turn.response_revision}`;
          if (
            !first &&
            turn.status === 'completed' &&
            turn.answer_id &&
            !spokenTurns.current.has(key)
          ) {
            const checked = refreshedAnswers.find(
              (answer) => answer.id === turn.answer_id,
            );
            if (
              !checked?.verification?.receipt.claims_reviewed ||
              !['verified', 'insufficient'].includes(checked.mode)
            )
              continue;
          }
          if (!first && !spokenTurns.current.has(key) && soundRef.current)
            capture.current?.speak(turn.response);
          spokenTurns.current.add(key);
        }
        first = false;
      } catch (problem) {
        if (alive && isAuthenticationError(problem)) {
          authExpired.current = true;
          setAuth(false);
        } else if (alive && !requests.signal.aborted && !authExpired.current)
          setConversationError(
            'Voice requests are reconnecting. Saved speech will retry.',
          );
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1250);
    return () => {
      alive = false;
      clearInterval(timer);
      requests.abort();
    };
  }, [auth]);
  async function ask(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setError('');
    try {
      await api('/conversation/text', {
        method: 'POST',
        body: JSON.stringify({ id: crypto.randomUUID(), text: question }),
      });
      setQuestion('');
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
          onClick={() => {
            if (sound) capture.current?.silenceSpeech();
            soundRef.current = !sound;
            setSound(!sound);
          }}
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
        <button
          className={view === 'computer' ? 'selected' : ''}
          onClick={() => setView('computer')}
        >
          Your computer
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
          disabled={state.requesting || state.finalizing}
          onClick={() => {
            if (state.recording) capture.current?.stop();
            else {
              soundRef.current = true;
              setSound(true);
              void capture.current?.start();
            }
          }}
        >
          {state.recording ? (
            <Square size={23} fill="currentColor" />
          ) : (
            <Radio size={26} />
          )}
          {state.requesting
            ? 'Opening camera…'
            : state.finalizing
              ? 'Saving last seconds…'
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
          Saves full video and audio while this page stays open. One frame each
          second and short audio clips are used for live analysis.{' '}
          {status?.analysis_ready === false
            ? 'Analysis is waiting for the ASUS model. Your recordings remain saved.'
            : status?.pending
              ? `${status.pending} recordings are being analyzed.`
              : 'Ask about what has been recorded and your connected sources.'}
        </p>
        {originals.some((recording) => recording.original_url) && (
          <details className="phone-fine">
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
                    Open original from{' '}
                    {new Date(recording.started_at * 1000).toLocaleTimeString(
                      [],
                      { hour: 'numeric', minute: '2-digit' },
                    )}
                  </a>{' '}
                  ({(recording.bytes / 1024 / 1024).toFixed(1)} MB)
                  {recording.end_reason !== 'stopped'
                    ? ' · interrupted recording'
                    : ''}
                </p>
              ))}
          </details>
        )}
        {(state.error || error || conversationError) && (
          <p className="phone-error" role="alert">
            {state.error || error || conversationError}
          </p>
        )}
        <section className="phone-ask">
          <h2>Just talk to me.</h2>
          <output
            className={
              'phone-voice ' + (state.voice === 'hearing' ? 'listening' : '')
            }
            aria-live="polite"
          >
            <Mic size={21} />
            {state.speaking
              ? 'Speaking · listening resumes afterward'
              : state.voice === 'hearing'
                ? 'I’m listening…'
                : conversation.status === 'awaiting_permission'
                  ? 'Waiting for your reply'
                  : [
                        'queued',
                        'transcribing',
                        'routing',
                        'thinking',
                        'checking',
                      ].includes(conversation.status)
                    ? 'Thinking about your request…'
                    : conversation.status === 'acting'
                      ? 'Working on your Mac…'
                      : state.recording && state.voice === 'listening'
                        ? 'Listening for questions and requests'
                        : state.voice === 'unavailable'
                          ? 'Voice unavailable · type below'
                          : 'Press Record, then speak naturally'}
          </output>
          <p className="phone-fine">
            Ask about your day or tell me what to do on your Mac. Pause when
            you’re done; no extra button is needed.
          </p>
          <form onSubmit={ask}>
            <input
              aria-label="Type a question or request"
              placeholder="Or type a question or Mac request…"
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
          {asking && <output>Sending your request…</output>}
          {conversation.turns
            .filter(
              (turn) =>
                turn.status !== 'ignored' &&
                (!turn.answer_id ||
                  !answers.some((answer) => answer.id === turn.answer_id)),
            )
            .slice(-3)
            .reverse()
            .map((turn) => (
              <article className="phone-answer" key={turn.id}>
                <h3>{turn.transcript || 'Hearing your words…'}</h3>
                <p>
                  {turn.response ||
                    (turn.status === 'acting'
                      ? 'Notch is working on your Mac…'
                      : 'Working on your request…')}
                </p>
              </article>
            ))}
          {answers.slice(0, 3).map((answer) => (
            <article className="phone-answer" key={answer.id}>
              <h3>{answer.question}</h3>
              {answer.mode === 'checking' && (
                <strong>Draft · checking the original evidence…</strong>
              )}
              <p>{answer.answer.replace(/\[[0-9a-f-]{36}\]/g, '')}</p>
              <div>
                <small>
                  {answer.mode === 'checking'
                    ? 'Waiting for Codex review'
                    : answer.mode === 'legacy_unverified'
                      ? 'Earlier answer · not checked'
                      : answer.mode === 'verified'
                        ? 'Checked against sources by ' +
                          (answer.verification?.receipt.reviews
                            ?.map((r) => r.model)
                            .join(' → ') || 'Codex')
                        : answer.mode === 'insufficient' &&
                            answer.verification?.receipt.claims_reviewed
                          ? 'Sources checked · evidence is incomplete'
                          : answer.grounded
                            ? `${answer.evidence.length} sources cited`
                            : 'Evidence incomplete'}
                </small>
                <button
                  aria-label="Read answer aloud"
                  disabled={
                    !(
                      answer.mode === 'verified' ||
                      (answer.mode === 'insufficient' &&
                        answer.verification?.receipt.claims_reviewed)
                    )
                  }
                  onClick={() => capture.current?.speak(answer.answer)}
                >
                  <Volume2 size={18} />
                </button>
              </div>
              {answer.verification?.receipt.reviews?.map((review) => (
                <details key={review.model}>
                  <summary>
                    {review.model} · {review.seconds.toFixed(1)}s
                  </summary>
                  <p>{review.result.reason}</p>
                </details>
              ))}
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
                  {source.original_recording?.original_url && (
                    <p className="phone-fine">
                      <a
                        href={source.original_recording.original_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Play original recording
                      </a>
                      {!source.original_recording
                        .continuous_video_inspected && (
                        <>
                          {' '}
                          · This answer used sampled evidence; the full video
                          has not been checked.
                        </>
                      )}
                    </p>
                  )}
                </details>
              ))}
            </article>
          ))}
        </section>
      </section>
      <section hidden={view !== 'context'}>
        <ContextPanel />
        <PeoplePanel />
      </section>
      <section hidden={view !== 'computer'}>
        <ComputerPanel visible={view === 'computer'} />
      </section>
      <footer className="phone-footer">
        Your moments. Your people. All connected.
      </footer>
    </main>
  );
}
