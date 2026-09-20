'use client';
/* oxlint-disable next/no-html-link-for-pages -- open the recording page with a full navigation */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUp, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { Orb } from './orb';
import { Card, Cell } from './primitives';
import { AnswerDetail, canSpeakAnswer } from './answer-detail';
import { api, type Answer, type Recording, type Heard } from '@/lib/api';
import { recordUtterance } from '@/lib/voice';
import { voiceTapFeedback } from '@/lib/voice-feedback';
import { useSpeechPlayback } from '@/lib/use-speech-playback';

export function AskCard({
  ask,
  answers,
  onOpen,
  index,
  disabled = false,
  label = 'Ask Rewind',
  placeholder = 'Ask Rewind anything',
  title = 'Ask',
}: {
  ask: (question: string) => Promise<Answer>;
  answers: Answer[];
  onOpen: (record: Recording) => void;
  index: number;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  title?: string;
}) {
  const [submitted, setSubmitted] = useState<Answer | null>(null);
  const [text, setText] = useState('');
  const [starting, setStarting] = useState(false);
  const [listening, setListening] = useState(false);
  const recordingReady = useRef(false);
  const microphone = useRef<AbortController | null>(null);
  const finishRecording = useRef<AbortController | null>(null);
  const [hearing, setHearing] = useState(false);
  useEffect(() => () => microphone.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sound, setSound] = useState(true);
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);
  const voice = useSpeechPlayback();
  const { speak, cancel } = voice;
  const attempted = useRef(new Set<string>());
  const pending = useRef(false);
  const answer = submitted
    ? (answers.find((item) => item.id === submitted.id) ?? submitted)
    : null;
  useEffect(() => {
    const changed = () => setVisibilityEpoch((epoch) => epoch + 1);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (
      !answer ||
      (!canSpeakAnswer(answer) && answer.mode !== 'no_evidence') ||
      attempted.current.has(answer.id) ||
      document.hidden
    )
      return;
    // A rejected playback stays available for an explicit retry, rather than
    // being attempted again on every answer poll.
    attempted.current.add(answer.id);
    if (sound && !disabled) void speak(answer.answer);
  }, [answer, sound, disabled, speak, visibilityEpoch]);
  useEffect(() => {
    if (disabled) {
      cancel();
      microphone.current?.abort();
    }
  }, [disabled, cancel]);
  const state = starting
    ? 'starting'
    : listening
      ? 'listening'
      : busy || hearing || answer?.mode === 'checking'
        ? 'thinking'
        : answer
          ? 'answer'
          : 'idle';
  async function go(question = text.trim()) {
    if (!question || pending.current || disabled || starting || listening)
      return;
    pending.current = true;
    setBusy(true);
    setError('');
    cancel();
    try {
      setSubmitted(await ask(question));
      setText('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function listen() {
    if (microphone.current) {
      if (finishRecording.current && !finishRecording.current.signal.aborted) {
        voiceTapFeedback();
        if (!recordingReady.current) microphone.current.abort();
        finishRecording.current.abort();
      }
      return;
    }
    if (pending.current || disabled) return;
    const controller = new AbortController();
    microphone.current = controller;
    const finish = new AbortController();
    finishRecording.current = finish;
    recordingReady.current = false;
    // Commit feedback while the tap still owns microphone/audio activation.
    flushSync(() => {
      setStarting(true);
      setError('');
    });
    voiceTapFeedback();
    try {
      voice.cancel();
      voice.unlock();
      const clip = await recordUtterance(
        undefined,
        controller.signal,
        finish.signal,
        undefined,
        () => {
          if (controller.signal.aborted || finish.signal.aborted) return;
          recordingReady.current = true;
          setStarting(false);
          setListening(true);
        },
      );
      setListening(false);
      if (controller.signal.aborted) return;
      if (!clip) throw new Error("I didn't hear anything. Please try again.");
      setHearing(true);
      const heard = await api<Heard>('/voice/hear?wake=false', {
        method: 'POST',
        headers: { 'Content-Type': clip.type },
        body: clip,
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(45000),
        ]),
      });
      if (controller.signal.aborted) return;
      if (!heard.question)
        throw new Error("I couldn't hear that clearly. Please try again.");
      setHearing(false);
      setText(heard.question);
      await go(heard.question);
    } catch (problem) {
      if (!controller.signal.aborted)
        setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      microphone.current = null;
      finishRecording.current = null;
      recordingReady.current = false;
      setStarting(false);
      setHearing(false);
      setListening(false);
    }
  }
  return (
    <Cell label={label} link index={index}>
      <Card className="card-dark card-ask" data-state={state}>
        <div className="row">
          <h2 className="card-title">{title}</h2>
          <span className="dim">
            <span className="live" />
            {starting
              ? 'Opening microphone… tap to cancel'
              : listening
                ? 'Listening… tap to send'
                : hearing
                  ? 'Transcribing…'
                  : busy
                    ? 'Thinking…'
                    : answer?.mode === 'checking'
                      ? 'Checking evidence'
                      : disabled
                        ? 'Reconnect to ask'
                        : 'Ready'}
          </span>
        </div>
        <button
          type="button"
          className="orb-stage"
          aria-label={
            starting
              ? 'Cancel opening microphone'
              : listening
                ? 'Finish and send question'
                : 'Ask by voice'
          }
          aria-pressed={starting || listening}
          disabled={busy || hearing || disabled}
          onClick={() => void listen()}
        >
          <Orb state={state} />
          <div className="waves" aria-hidden="true">
            {[3, 1, 4, 0, 2, 5, 3].map((n, i) => (
              <i key={i} style={{ '--n': n } as React.CSSProperties} />
            ))}
          </div>
        </button>
        <div className="ask-body">
          {answer ? (
            <AnswerDetail answer={answer} onOpen={onOpen} playback={voice} />
          ) : (
            <p className="hint">Tap the orb to talk, or type below.</p>
          )}
          {error && (
            <p role="alert" className="ask-error">
              {error}
            </p>
          )}
        </div>
        <form
          className="ask-bar"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            voice.unlock();
            void go();
          }}
        >
          <button
            type="button"
            className={`gbtn gbtn-round ${starting || listening ? 'is-live' : ''}`}
            aria-label={
              starting
                ? 'Cancel opening microphone'
                : listening
                  ? 'Finish and send question'
                  : 'Record a question'
            }
            disabled={busy || hearing || disabled}
            onClick={() => void listen()}
          >
            {starting || listening ? <Square fill="currentColor" /> : <Mic />}
          </button>
          <label className={`ask-input ${text ? 'has-text' : ''}`}>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={placeholder}
              aria-label="Ask about your recordings"
              disabled={busy || hearing || starting || listening || disabled}
              maxLength={2000}
            />
            <button
              type="submit"
              className="send"
              aria-label="Send question"
              disabled={
                busy ||
                hearing ||
                starting ||
                listening ||
                disabled ||
                !text.trim()
              }
            >
              <ArrowUp />
            </button>
          </label>
        </form>
        <div className="ask-voice-controls">
          <button
            type="button"
            className="voice-action"
            aria-label="Spoken answers"
            aria-pressed={sound}
            disabled={disabled}
            onClick={() => {
              setSound(!sound);
              if (sound) voice.cancel();
              else void voice.speak('Voice is on.');
            }}
          >
            {sound ? <Volume2 /> : <VolumeX />}
            Voice {sound ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="voice-action"
            disabled={disabled}
            onClick={() => {
              setSound(true);
              void voice.speak('Voice is on.');
            }}
          >
            Test voice
          </button>
          {voice.speaking && <output>Speaking</output>}
        </div>
        {voice.speechError && (
          <div className="voice-error" role="alert">
            <p>{voice.speechError}</p>
            <button
              className="voice-action"
              type="button"
              disabled={disabled}
              onClick={() => void voice.retry()}
            >
              Retry voice
            </button>
          </div>
        )}
      </Card>
    </Cell>
  );
}
