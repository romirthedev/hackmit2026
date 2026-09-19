'use client';
import { Textarea } from '@/components/ui/textarea';
import { CatalogButton } from '@/components/catalog';

import { useEffect, type RefObject, type SubmitEvent } from 'react';
import { ArrowUp, Sparkles, LoaderCircle } from 'lucide-react';
import { AudioCapture } from '@/components/audio-capture';

export function MemoryComposer({
  question,
  onChange,
  onSubmit,
  inputRef,
  busy,
  asking,
  local,
  model,
  onVoiceUpdate,
  onError,
}: {
  question: string;
  onChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  asking: boolean;
  local: boolean;
  model?: string;
  onVoiceUpdate: () => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(220, Math.max(105, input.scrollHeight))}px`;
  }, [question, inputRef]);
  return (
    <form
      className={
        'question-composer enhanced-composer ' + (asking ? 'is-thinking' : '')
      }
      onSubmit={onSubmit}
      aria-busy={asking}
    >
      <div className="composer-context" title={model}>
        <Sparkles size={14} />
        <span>{local ? 'Local memory AI' : 'Memory AI'}</span>
        <span className="composer-context-dot" />
        <span>With evidence</span>
      </div>
      <label htmlFor="question" className="sr-only">
        Ask a question about your recordings
      </label>
      <Textarea
        id="question"
        ref={inputRef}
        value={question}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Where did I leave…"
        rows={3}
        required
        maxLength={2000}
        disabled={asking}
        onKeyDown={(e) => {
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            if (!busy && question.trim()) e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-toolbar">
        <AudioCapture
          question
          disabled={busy}
          onUpdate={onVoiceUpdate}
          onError={onError}
        />
        <CatalogButton
          type="submit"
          className="composer-send"
          disabled={busy || !question.trim()}
          aria-label={asking ? 'Finding your answer' : 'Ask memory'}
          title="Ask memory (⌘ / Ctrl + Enter)"
        >
          {asking ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ArrowUp size={19} />
          )}
        </CatalogButton>
      </div>
      <div className="composer-hint">
        <span>
          {asking
            ? 'Looking through your recordings…'
            : '⌘ / Ctrl + Enter to ask'}
        </span>
        <span>{question.length.toLocaleString()} / 2,000</span>
      </div>
    </form>
  );
}
