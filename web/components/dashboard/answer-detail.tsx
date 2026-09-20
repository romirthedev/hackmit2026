'use client';
import type { Answer, Recording } from '@/lib/api';
import { Volume2, Square } from 'lucide-react';
import {
  useSpeechPlayback,
  type SpeechPlayback,
} from '@/lib/use-speech-playback';

export function isCachedAnswer(answer: Answer) {
  return (
    answer.mode === 'demo_cached' &&
    answer.verification?.receipt?.cached === true &&
    answer.verification?.receipt?.claims_reviewed === true
  );
}

export function isReviewedAnswer(answer: Answer) {
  return (
    answer.verification?.receipt?.claims_reviewed === true &&
    (answer.mode === 'verified' ||
      answer.mode === 'insufficient' ||
      isCachedAnswer(answer))
  );
}

export function canSpeakAnswer(answer: Answer) {
  return answer.mode === 'conversation' || isReviewedAnswer(answer);
}

export function answerState(answer: Answer) {
  if (isCachedAnswer(answer)) return 'Saved walkthrough · source reviewed';
  if (answer.mode === 'conversation') return 'Rewind';
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
  playback,
}: {
  answer: Answer;
  onOpen: (record: Recording) => void;
  playback?: SpeechPlayback;
}) {
  const localPlayback = useSpeechPlayback();
  const voice = playback ?? localPlayback;
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
        className={`answer-state ${isReviewedAnswer(answer) ? 'reviewed' : ''}`}
      >
        {answerState(answer)}
      </span>
      <p className="answer-copy">{text || 'Waiting for an answer.'}</p>
      <div className="answer-voice">
        <button
          type="button"
          className="voice-action"
          disabled={!canSpeakAnswer(answer) || !answer.answer}
          aria-label={
            voice.speaking ? 'Stop reading answer' : 'Read answer aloud'
          }
          onClick={() =>
            voice.speaking ? voice.cancel() : void voice.speak(answer.answer)
          }
        >
          {voice.speaking ? <Square /> : <Volume2 />}
          {voice.speaking ? 'Stop reading' : 'Read aloud'}
        </button>
        {!canSpeakAnswer(answer) && <small>Voice available after review</small>}
      </div>
      {!playback && voice.speechError && (
        <div className="voice-error" role="alert">
          <p>{voice.speechError}</p>
          <button
            className="voice-action"
            type="button"
            onClick={() => void voice.retry()}
          >
            Retry voice
          </button>
        </div>
      )}
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
