'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { Card, Cell } from './primitives';
import { Orb } from './orb';
import { AnswerDetail } from './answer-detail';
import type { Answer, Recording } from '@/lib/api';
import {
  recordUtterance,
  type VoiceClient,
  type VoiceState,
} from '@/lib/voice';

export function AskCard({
  ask,
  answers,
  onOpen,
  index,
  voice,
  disabled = false,
  label = 'Ask Rewind',
  placeholder = 'What would you like to remember?',
  title = 'Ask',
}: {
  ask: (question: string) => Promise<Answer>;
  answers: Answer[];
  onOpen: (record: Recording) => void;
  index: number;
  voice: VoiceClient | null;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  title?: string;
}) {
  const [submitted, setSubmitted] = useState<Answer | null>(null);
  const [text, setText] = useState('');
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [sound, setSound] = useState(true);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const abortListen = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!voice) return;
    const unsubscribe = voice.subscribe((next) => setVoiceState(next));
    return () => {
      unsubscribe();
    };
  }, [voice]);
  useEffect(() => {
    voice?.setMuted(!sound);
  }, [voice, sound]);
  const answer = submitted
    ? (answers.find((item) => item.id === submitted.id) ?? null)
    : null;
  const state = listening
    ? 'listening'
    : busy || answer?.mode === 'checking'
      ? 'thinking'
      : voiceState === 'speaking'
        ? 'answer'
        : answer
          ? 'answer'
          : 'idle';
  async function go(question = text.trim()) {
    if (!question || pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (voice) {
        const result = await voice.ask(question);
        setSubmitted(result.answer);
        if (result.error) setError(result.error);
      } else setSubmitted(await ask(question));
      setText('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function listen() {
    if (!voice || disabled) return;
    if (listening) {
      abortListen.current?.abort();
      return;
    }
    voice.unlock();
    voice.stop();
    setError('');
    setHeard('');
    setListening(true);
    const controller = new AbortController();
    abortListen.current = controller;
    try {
      const clip = await recordUtterance(setLevel, controller.signal);
      setListening(false);
      if (!clip) {
        setError("I didn't catch anything. Tap the microphone and try again.");
        return;
      }
      const result = await voice.hear(clip, false);
      if (!result.transcript) {
        setError("I couldn't make that out. Try again a little closer.");
        return;
      }
      setHeard(result.transcript);
      await go(result.question || result.transcript);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setListening(false);
      setLevel(0);
      abortListen.current = null;
    }
  }
  const hint = listening
    ? 'Listening… pause when you are done.'
    : voiceState === 'speaking'
      ? 'Speaking…'
      : voiceState === 'hearing'
        ? 'Heard you, one moment…'
        : busy
          ? 'Looking through your day…'
          : disabled
            ? 'Reconnect to ask'
            : 'Ready';
  return (
    <Cell label={label} index={index}>
      <Card className="card-dark card-ask" data-state={state}>
        <div className="row">
          <span className="card-title">{title}</span>
          <span className="ask-tools">
            <span className="dim">{hint}</span>
            <button
              type="button"
              className={`dim ask-sound ${sound ? 'is-on' : ''}`}
              aria-pressed={sound}
              aria-label="Spoken answers"
              onClick={() => {
                if (!sound) voice?.unlock();
                setSound((value) => !value);
              }}
            >
              {sound ? <Volume2 /> : <VolumeX />}
            </button>
          </span>
        </div>
        <button
          type="button"
          className={`orb-stage ${listening ? 'is-listening' : ''}`}
          onClick={() => void listen()}
          aria-label={listening ? 'Stop listening' : 'Ask by voice'}
          disabled={disabled || busy}
          style={{ '--level': level } as React.CSSProperties}
        >
          <Orb state={state} />
        </button>
        <div className="ask-body">
          {answer ? (
            <>
              {heard && <p className="ask-heard">“{heard}”</p>}
              <AnswerDetail answer={answer} onOpen={onOpen} />
            </>
          ) : (
            <p className="hint">
              {heard
                ? `“${heard}”`
                : 'Tap the orb and ask out loud, or type below. Try “where did I leave my glasses?”'}
            </p>
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
            voice?.unlock();
            void go();
          }}
        >
          <button
            type="button"
            className={`gbtn gbtn-round ${listening ? 'is-live' : ''}`}
            aria-label={listening ? 'Stop listening' : 'Ask by voice'}
            aria-pressed={listening}
            disabled={disabled || busy}
            onClick={() => void listen()}
          >
            {listening ? <Square fill="currentColor" /> : <Mic />}
          </button>
          <label className={`ask-input ${text ? 'has-text' : ''}`}>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={placeholder}
              aria-label="Ask about your recordings"
              disabled={busy || disabled}
              maxLength={2000}
            />
            <button
              type="submit"
              className="send"
              aria-label="Send question"
              disabled={busy || disabled || !text.trim()}
            >
              <ArrowUp />
            </button>
          </label>
        </form>
      </Card>
    </Cell>
  );
}
