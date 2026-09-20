'use client';
/* oxlint-disable next/no-html-link-for-pages -- open the recording page with a full navigation */
import { useRef, useState } from 'react';
import { ArrowUp, Mic, CornerDownRight } from 'lucide-react';
import { Card, Cell } from './primitives';
import { AnswerDetail } from './answer-detail';
import type { Answer, Recording } from '@/lib/api';

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
            {answer && <AnswerDetail answer={answer} onOpen={onOpen} />}
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
