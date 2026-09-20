'use client';
import type { Answer, Recording } from '@/lib/api';

export function answerState(answer: Answer) {
  const reviewed = answer.verification?.receipt?.claims_reviewed === true;
  if (answer.mode === 'verified' && reviewed) return 'Verified answer';
  if (answer.mode === 'insufficient' && reviewed)
    return 'Reviewed · limited evidence';
  if (answer.mode === 'checking') return 'Checking evidence · draft';
  if (answer.mode === 'no_evidence') return 'No recorded evidence found';
  if (answer.mode === 'source_changed') return 'Source unavailable';
  return 'Unverified answer';
}

export function AnswerDetail({
  answer,
  onOpen,
}: {
  answer: Answer;
  onOpen: (record: Recording) => void;
}) {
  const evidence = answer.evidence || [];
  const text = answer.answer.replace(
    /\[([0-9a-f-]{36})\]/g,
    (match, id: string) => {
      const index = evidence.findIndex((record) => record.id === id);
      return index >= 0 ? `[${index + 1}]` : match;
    },
  );
  return (
    <div className="answer-detail" aria-live="polite">
      <span
        className={`answer-state ${answer.mode === 'verified' && answer.verification?.receipt?.claims_reviewed ? 'reviewed' : ''}`}
      >
        {answerState(answer)}
      </span>
      <p className="answer-copy">{text || 'Waiting for an answer.'}</p>
      {evidence.length > 0 && (
        <div className="answer-sources" aria-label="Answer sources">
          {evidence.map((record, index) => (
            <button
              type="button"
              className="chip"
              key={record.id}
              onClick={() => onOpen(record)}
              aria-label={`Open source ${index + 1}`}
            >
              Source {index + 1} ·{' '}
              {record.kind === 'context'
                ? record.context_kind || 'Notch'
                : record.kind === 'audio'
                  ? 'Audio'
                  : 'Photo'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
