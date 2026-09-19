'use client';
// Camera originals use authenticated same-origin URLs, without an image optimizer.
/* oxlint-disable next/no-img-element */

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from 'react';
import {
  Camera,
  Check,
  Clock3,
  FileAudio,
  Sparkles,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { clock, type Recording, type Status } from '@/lib/api';

export function AnimatedNumber({
  value,
  format = (n: number) => Math.round(n).toLocaleString(),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    if (reduced.matches || from === value || document.hidden) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const finish = () => {
      cancelAnimationFrame(frame);
      setDisplay(value);
    };
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      setDisplay(from + (value - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    reduced.addEventListener('change', finish);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener('change', finish);
    };
  }, [value]);
  return (
    <>
      <span aria-hidden="true">{format(display)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

export function SpotlightCard({
  className = '',
  order = 0,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { order?: number }) {
  return (
    <button
      {...props}
      className={'spotlight-card memory-enter ' + className}
      style={
        {
          ...props.style,
          '--entry-delay': `${Math.min(order, 7) * 35}ms`,
        } as CSSProperties
      }
      onPointerMove={(e) => {
        if (
          e.pointerType !== 'mouse' ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        )
          return;
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty(
          '--spot-x',
          `${e.clientX - rect.left}px`,
        );
        e.currentTarget.style.setProperty(
          '--spot-y',
          `${e.clientY - rect.top}px`,
        );
      }}
    >
      {children}
    </button>
  );
}

export function RecordingStatus({ recording }: { recording: Recording }) {
  // Search results are analyzed events and may omit the original job status.
  const ready =
    recording.status === 'done' ||
    (!recording.status &&
      (recording.summary != null || recording.transcript != null));
  const failed = recording.status === 'failed';
  return (
    <span
      className={
        'recording-status ' + (ready ? 'ready' : failed ? 'failed' : '')
      }
    >
      {ready ? (
        <Check size={12} />
      ) : failed ? (
        <AlertCircle size={12} />
      ) : (
        <Clock3 size={12} />
      )}
      {ready
        ? 'Ready'
        : failed
          ? 'Needs attention'
          : recording.status
            ? 'Processing'
            : 'Saved'}
    </span>
  );
}

export function MemoryFilmstrip({
  records,
  currentId,
  timezone,
  onSelect,
}: {
  records: Recording[];
  currentId?: string;
  timezone?: string;
  onSelect: (index: number) => void;
}) {
  const strip = useRef<HTMLFieldSetElement>(null);
  // A bounded window keeps replay navigable without loading every image at once.
  const currentIndex = Math.max(
    0,
    records.findIndex((r) => r.id === currentId),
  );
  const start = Math.max(0, Math.min(currentIndex - 3, records.length - 8));
  const windowRecords = records.slice(start, start + 8);
  useEffect(() => {
    const rail = strip.current;
    const selected = rail?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    if (rail && selected)
      rail.scrollTo({
        left:
          selected.offsetLeft - rail.clientWidth / 2 + selected.clientWidth / 2,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
  }, [currentId, start]);
  if (!records.length) return null;
  return (
    <fieldset ref={strip} className="filmstrip">
      <legend className="sr-only">Nearby recordings</legend>
      {windowRecords.map((r, i) => (
        <button
          key={r.id}
          type="button"
          className={
            'filmstrip-frame ' + (r.id === currentId ? 'is-current' : '')
          }
          aria-pressed={r.id === currentId}
          aria-label={`Replay ${r.kind === 'frame' ? 'frame' : 'audio'} from ${clock(r.captured_at, timezone)}`}
          onClick={() => onSelect(start + i)}
        >
          {r.kind === 'frame' ? (
            <img src={r.media_url} alt="" loading="lazy" />
          ) : (
            <FileAudio size={22} />
          )}
          <span>{clock(r.captured_at, timezone)}</span>
        </button>
      ))}
    </fieldset>
  );
}

export function ProcessingJourney({
  status,
  onOpen,
}: {
  status: Status;
  onOpen: () => void;
}) {
  const percent = status.received
    ? Math.min(100, (status.analyzed / status.received) * 100)
    : 0;
  return (
    <div className="processing-journey">
      <div className="processing-stages" aria-label="Recording pipeline">
        <span>
          <Camera size={15} /> Saved <b>{status.received.toLocaleString()}</b>
        </span>
        <ArrowRight size={13} aria-hidden="true" />
        <span className={status.pending ? 'is-processing' : ''}>
          <Sparkles size={15} /> Processing{' '}
          <b>{status.pending.toLocaleString()}</b>
        </span>
        <ArrowRight size={13} aria-hidden="true" />
        <span>
          <Check size={15} /> Ready <b>{status.analyzed.toLocaleString()}</b>
        </span>
      </div>
      <Progress
        value={percent}
        aria-label="Saved recordings analyzed"
        className="analysis-progress"
      />
      <button type="button" className="text-button" onClick={onOpen}>
        {status.failed
          ? `${status.failed.toLocaleString()} need attention`
          : 'View status'}{' '}
        <ArrowRight size={13} />
      </button>
    </div>
  );
}
