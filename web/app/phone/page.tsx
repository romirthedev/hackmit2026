'use client';
/* oxlint-disable next/no-html-link-for-pages -- Static FastAPI export serves full documents and has no RSC prefetch endpoint. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
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
  type ConversationState,
} from '@/lib/api';
import { PhoneCapture, type CaptureState } from '@/lib/phone-capture';
import { ComputerPanel } from '@/components/computer-panel';
import { ContextPanel } from '@/components/context-panel';
import { PeoplePanel } from '@/components/people-panel';
import { Card, Cell, hm } from '@/components/dashboard/primitives';
import { SendLetter, type Send } from '@/components/dashboard/letter';
import '@/app/dashboard.css';
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
type VoicePlayback = {
  key: string;
  text: string;
  onPlayed: () => void;
  answer?: { id: string; text: string };
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
export default function Phone() {
  const video = useRef<HTMLVideoElement>(null);
  const capture = useRef<PhoneCapture | null>(null);
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
  const [conversation, setConversation] = useState<ConversationState>({
    status: 'listening',
    turns: [],
  });
  const [conversationError, setConversationError] = useState('');
  const spokenTurns = useRef(new Set<string>());
  const ignoredTurns = useRef(new Set<string>());
  const pendingSpeech = useRef(new Set<string>());
  const pendingAnswerSpeech = useRef(new Set<string>());
  const deliveredAnswerText = useRef(new Map<string, string>());
  const failedSpeech = useRef(new Set<string>());
  const lastFailedPlayback = useRef<
    (VoicePlayback & { attempt: Promise<boolean> }) | null
  >(null);
  const answerFetchVersion = useRef(0);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'record' | 'context' | 'computer'>('record');
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const authExpired = useRef(false);
  const trackPlayback = useCallback(
    (
      entry: VoicePlayback,
      controller: PhoneCapture,
      result: Promise<boolean>,
    ) => {
      pendingSpeech.current.add(entry.key);
      if (entry.answer) pendingAnswerSpeech.current.add(entry.answer.id);
      void result.then((played) => {
        pendingSpeech.current.delete(entry.key);
        if (entry.answer) pendingAnswerSpeech.current.delete(entry.answer.id);
        if (authExpired.current || capture.current !== controller) return;
        if (played) {
          failedSpeech.current.delete(entry.key);
          if (entry.answer)
            deliveredAnswerText.current.set(entry.answer.id, entry.answer.text);
          entry.onPlayed();
          if (lastFailedPlayback.current?.key === entry.key)
            lastFailedPlayback.current = null;
        } else if (controller.isFailedSpeech(result)) {
          failedSpeech.current.add(entry.key);
          lastFailedPlayback.current = { ...entry, attempt: result };
        }
      });
    },
    [],
  );
  const queueSpeech = useCallback(
    (entry: VoicePlayback, fromGesture = false) => {
      const controller = capture.current;
      if (
        !controller ||
        authExpired.current ||
        pendingSpeech.current.has(entry.key) ||
        (entry.answer && pendingAnswerSpeech.current.has(entry.answer.id))
      )
        return;
      if (
        !fromGesture &&
        (failedSpeech.current.has(entry.key) || controller.state.speechError)
      )
        return;
      trackPlayback(
        entry,
        controller,
        fromGesture
          ? controller.speakFromGesture(entry.text)
          : controller.speak(entry.text),
      );
    },
    [trackPlayback],
  );
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
              queueSpeech({
                key: `reminder:${reminder.id}`,
                text: reminder.message,
                onPlayed: () => announced.current.add(reminder.id),
              });
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
  }, [auth, queueSpeech]);
  useEffect(() => {
    if (auth !== true || !video.current) return;
    const controller = new PhoneCapture(video.current, setState);
    capture.current = controller;
    return () => {
      cancelScanner();
      controller.dispose();
      capture.current = null;
    };
  }, [auth, cancelScanner]);
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
              !pendingAnswerSpeech.current.has(turn.answer_id) &&
              !spokenTurns.current.has(
                `${turn.id}:${turn.response_revision}`,
              ) &&
              !ignoredTurns.current.has(
                `${turn.id}:${turn.response_revision}`,
              ) &&
              !pendingSpeech.current.has(
                `${turn.id}:${turn.response_revision}`,
              ) &&
              !failedSpeech.current.has(`${turn.id}:${turn.response_revision}`),
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
            if (first || !soundRef.current)
              ignoredTurns.current.add(acknowledgement);
            else if (
              !spokenTurns.current.has(acknowledgement) &&
              !ignoredTurns.current.has(acknowledgement)
            )
              queueSpeech({
                key: acknowledgement,
                text: 'Let me check that.',
                onPlayed: () => spokenTurns.current.add(acknowledgement),
              });
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
          if (first || !soundRef.current) {
            ignoredTurns.current.add(key);
            continue;
          }
          if (
            spokenTurns.current.has(key) ||
            ignoredTurns.current.has(key) ||
            pendingSpeech.current.has(key) ||
            failedSpeech.current.has(key)
          )
            continue;
          if (turn.answer_id && pendingAnswerSpeech.current.has(turn.answer_id))
            continue;
          let checkedAnswer: Answer | undefined;
          if (
            !first &&
            turn.status === 'completed' &&
            turn.answer_id &&
            !spokenTurns.current.has(key)
          ) {
            checkedAnswer = refreshedAnswers.find(
              (answer) => answer.id === turn.answer_id,
            );
            if (
              !checkedAnswer?.verification?.receipt.claims_reviewed ||
              !['verified', 'insufficient'].includes(checkedAnswer.mode)
            )
              continue;
            // A manual read and this conversation response share one checked
            // answer. Count a completed manual playback, never replay it on poll.
            if (
              deliveredAnswerText.current.get(checkedAnswer.id) ===
              checkedAnswer.answer
            ) {
              spokenTurns.current.add(key);
              continue;
            }
          }
          queueSpeech({
            key,
            text: turn.response,
            answer: checkedAnswer
              ? { id: checkedAnswer.id, text: checkedAnswer.answer }
              : undefined,
            onPlayed: () => spokenTurns.current.add(key),
          });
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
  }, [auth, queueSpeech]);
  function testVoice() {
    soundRef.current = true;
    setSound(true);
    void capture.current?.testVoice();
  }
  function retryVoice() {
    const controller = capture.current;
    if (!controller || authExpired.current) return;
    soundRef.current = true;
    setSound(true);
    const entry = lastFailedPlayback.current;
    const retryMatches = entry && controller.isFailedSpeech(entry.attempt);
    const result = controller.retrySpeech();
    if (entry && retryMatches) trackPlayback(entry, controller, result);
  }
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
  function toggleRecording() {
    if (state.recording || state.requesting) {
      ++scanGeneration.current;
      capture.current?.stop();
    } else {
      soundRef.current = true;
      setSound(true);
      void capture.current?.testVoice();
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
      setScanNotice(
        'Photo queued on this phone. It will upload when connected.',
      );
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
  const thinking = [
    'queued',
    'transcribing',
    'routing',
    'thinking',
    'checking',
  ].includes(conversation.status);
  const voiceLabel = state.speaking
    ? 'Speaking · listening resumes afterward'
    : state.voice === 'hearing'
      ? 'I’m listening…'
      : conversation.status === 'awaiting_permission'
        ? 'Waiting for your reply'
        : thinking
          ? 'Thinking about your request…'
          : conversation.status === 'acting'
            ? 'Working on your Mac…'
            : state.recording && state.voice === 'listening'
              ? 'Listening for questions and requests'
              : state.voice === 'unavailable'
                ? 'Voice unavailable · type below'
                : 'Press Record, then speak naturally';
  const voiceState =
    state.voice === 'hearing'
      ? 'listening'
      : thinking || asking || conversation.status === 'acting'
        ? 'thinking'
        : state.speaking
          ? 'answer'
          : 'idle';
  const cameraOn = state.recording || state.previewing;
  const zone = status?.timezone;
  if (auth === false) return <Login />;
  if (auth === null)
    return (
      <div className="rw ph">
        <main className="ph-page ph-wait">
          <span className="ph-wordmark">rewind</span>
          <p>{error || 'Connecting…'}</p>
        </main>
      </div>
    );
  return (
    <div className="rw ph">
      <div className="ph-sheet">
        <header className="ph-top">
          <a href="/" className="rw-brand" aria-label="Open workspace">
            rewind
            <span className="ph-header-time">{clock}</span>
          </a>
          <span className="ph-memory" title="Items saved on the server">
            <b className="tabular">{status?.received ?? 0}</b>
            <span>saved items</span>
          </span>
        </header>
        <main className="ph-page">
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
          {(state.error || error || conversationError) && (
            <div className="rw-banner" role="alert">
              {state.error || error || conversationError}
            </div>
          )}
          <section hidden={view !== 'record'}>
            <div className="greeting">
              <h1>Recorder</h1>
              <p>
                {state.recording
                  ? `Recording${state.startedAt ? ` since ${hm(state.startedAt / 1000, zone)}` : ''}. Keep this page open.`
                  : 'Keep this page open while recording.'}
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
            <Cell label="Camera" index={1}>
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
                      <span>Camera preview</span>
                    </span>
                  )}
                </div>
                <div className="media-foot">
                  <span className="media-title">
                    {state.recording
                      ? 'Recording'
                      : state.finalizing
                        ? 'Saving last seconds…'
                        : state.previewing
                          ? 'Camera on'
                          : 'Ready to record'}
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
                {state.recording ? (
                  <Square fill="currentColor" />
                ) : (
                  <span className="ph-record-dot" aria-hidden="true" />
                )}
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
                {scanning ? 'Scanning…' : 'Scan'}
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
                      ? 'Preview only · tap Scan to save a photo'
                      : 'Camera is off'}
                </span>
              </div>
              <p className="phone-fine">
                Record saves full video and audio. Answers use sampled images
                and speech.{' '}
                {status?.analysis_ready === false
                  ? 'Analysis is waiting for the ASUS model; saved uploads will wait.'
                  : status?.pending
                    ? `${status.pending} items are waiting for analysis.`
                    : ''}
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
            <Cell label="Conversation" index={2}>
              <Card className="card-ask" data-state={voiceState}>
                <div className="row">
                  <output className="ph-voice-status" aria-live="polite">
                    <span className="ph-status-dot" aria-hidden="true" />
                    {voiceLabel}
                  </output>
                  <button
                    type="button"
                    className={`dim ask-sound ${sound ? 'is-on' : ''}`}
                    aria-pressed={sound}
                    aria-label="Spoken answers and reminders"
                    onClick={() => {
                      if (sound) {
                        capture.current?.silenceSpeech();
                        soundRef.current = false;
                        setSound(false);
                      } else testVoice();
                    }}
                  >
                    {sound ? <Volume2 /> : <VolumeX />}
                  </button>
                </div>
                <div className="ask-body">
                  <p className="hint">
                    Ask about a recording or request an action on your Mac.
                  </p>
                </div>
                <div className="ph-voice-controls">
                  <button type="button" onClick={testVoice}>
                    Test voice
                  </button>
                  {state.speechRetryAvailable && (
                    <button type="button" onClick={retryVoice}>
                      Retry voice
                    </button>
                  )}
                </div>
                {state.speechError && (
                  <p className="ph-speech-error" role="alert">
                    {state.speechError}
                  </p>
                )}
                <form className="ask-bar" autoComplete="off" onSubmit={ask}>
                  <label className={`ask-input ${question ? 'has-text' : ''}`}>
                    <input
                      aria-label="Type a question or request"
                      placeholder="Or type here…"
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
                {asking && <output>Sending your request…</output>}
              </Card>
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
                          : answer.mode === 'verified' &&
                              answer.verification?.receipt.claims_reviewed
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
                          ['verified', 'insufficient'].includes(answer.mode) &&
                          answer.verification?.receipt.claims_reviewed
                        )
                      }
                      onClick={() =>
                        queueSpeech(
                          {
                            key: `answer:${answer.id}`,
                            text: answer.answer,
                            answer: { id: answer.id, text: answer.answer },
                            onPlayed: () => {},
                          },
                          true,
                        )
                      }
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
                              · This answer used sampled evidence; the full
                              video has not been checked.
                            </>
                          )}
                        </p>
                      )}
                    </details>
                  ))}
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
          </footer>
        </main>
      </div>
      <SendLetter send={send} onDone={sendDone} />
    </div>
  );
}
