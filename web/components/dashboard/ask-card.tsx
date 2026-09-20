'use client';
/* oxlint-disable next/no-html-link-for-pages -- open the recording page with a full navigation */
import { useRef, useState } from 'react';
import { ArrowUp, Mic } from 'lucide-react';
import { Card, Cell } from './primitives';
import { Orb } from './orb';
import { AnswerDetail } from './answer-detail';
import type { Answer, Recording } from '@/lib/api';

export function AskCard({
  ask,
  answers,
  onOpen,
  index,
  disabled = false,
  label = 'Ask Rewind',
  placeholder = 'What would you like to remember?',
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const answer = submitted
    ? (answers.find((item) => item.id === submitted.id) ?? null)
    : null;
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
      <Card className="card-dark card-ask" data-state={state}>
        <div className="row">
          <span className="card-title">{title}</span>
          <span className="dim">
            {busy
              ? 'Finding evidence'
              : answer?.mode === 'checking'
                ? 'Checking evidence'
                : disabled
                  ? 'Reconnect to ask'
                  : 'Ready'}
          </span>
        </div>
        <a
          className="orb-stage"
          href="/phone"
          aria-label="Open phone voice recording"
        >
          <Orb state={state} />
        </a>
        <div className="ask-body">
          {answer ? (
            <AnswerDetail answer={answer} onOpen={onOpen} />
          ) : (
            <p className="hint">
              Ask about your saved day, or open your phone to record and talk.
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
            void go();
          }}
        >
          <a
            className="gbtn gbtn-round"
            href="/phone"
            aria-label="Open phone voice recording"
          >
            <Mic />
          </a>
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
