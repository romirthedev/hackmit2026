'use client';
/* oxlint-disable next/no-html-link-for-pages -- open the recording page with a full navigation */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, CornerDownRight, Volume2, VolumeX } from 'lucide-react';
import { Card, Cell } from './primitives';
import { AnswerDetail, isReviewedAnswer } from './answer-detail';
import type { Answer, Recording } from '@/lib/api';
import { useSpeechPlayback } from '@/lib/use-speech-playback';

export function AskCard({
  ask,
  answers,
  onOpen,
  index,
  disabled = false,
  label = 'Recall',
  placeholder = 'What would you like to remember?',
  title = 'Ask your memory',
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
      !isReviewedAnswer(answer) ||
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
    if (disabled) cancel();
  }, [disabled, cancel]);
  const state =
    busy || answer?.mode === 'checking'
      ? 'thinking'
      : answer
        ? 'answer'
        : 'idle';
  async function go() {
    const question = text.trim();
    if (!question || pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError('');
    if (sound) void speak("I'll check that.");
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
  return (
    <Cell label={label} index={index}>
      <Card className="card-ask recall-composer" data-state={state}>
        <div className="row">
          <h2 className="card-title">{title}</h2>
        </div>
        <p className="recall-description">
          Find a moment, a conversation, or something you left behind.
        </p>
        <form
          className="recall-form"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void go();
          }}
        >
          <textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={placeholder}
            aria-label="Ask about your recordings"
            disabled={busy || disabled}
            maxLength={2000}
          />
          <div className="recall-form-footer">
            <a href="/phone" aria-label="Open phone voice recording">
              <Mic /> Ask by voice
            </a>
            <button
              type="submit"
              className="recall-submit"
              aria-label="Send question"
              disabled={busy || disabled || !text.trim()}
            >
              <ArrowUp />
            </button>
          </div>
        </form>
        <div className="recall-voice-controls">
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
        {!submitted && !text && (
          <div className="recall-prompts" aria-label="Question suggestions">
            {['Where did I leave my keys?', 'What did we talk about?'].map(
              (prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setText(prompt)}
                  disabled={busy || disabled}
                >
                  <CornerDownRight />
                  {prompt}
                </button>
              ),
            )}
          </div>
        )}
        <div className="recall-footnote" aria-live="polite">
          <span className="recall-status-dot" />
          <span>
            {busy
              ? 'Finding evidence'
              : answer?.mode === 'checking'
                ? 'Checking evidence'
                : disabled
                  ? 'Reconnect to ask'
                  : 'Answers linked to your recordings'}
          </span>
        </div>
        {(answer || error) && (
          <div className="ask-body">
            {answer && (
              <AnswerDetail answer={answer} onOpen={onOpen} playback={voice} />
            )}
            {error && (
              <p role="alert" className="ask-error">
                {error}
              </p>
            )}
          </div>
        )}
      </Card>
    </Cell>
  );
}
