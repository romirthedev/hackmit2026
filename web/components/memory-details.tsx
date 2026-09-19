'use client';
import { CatalogButton } from '@/components/catalog';
// Camera originals use authenticated same-origin URLs, without an image optimizer.
/* oxlint-disable next/no-img-element */

import { useEffect, useRef, type ComponentProps } from 'react';
import { useReducedMotion } from 'motion/react';
import CountUp from '@/components/react-bits/CountUp';
import ReactBitsSpotlight from '@/components/react-bits/SpotlightCard';
import AnimatedItem from '@/components/react-bits/AnimatedItem';
import { FrameImage } from '@/components/catalog';
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
  format,
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  return (
    <>
      <span aria-hidden="true">
        {format ? (
          format(value)
        ) : reduced ? (
          value.toLocaleString()
        ) : (
          <CountUp to={value} duration={0.7} separator="," />
        )}
      </span>
      <span className="sr-only">
        {format ? format(value) : value.toLocaleString()}
      </span>
    </>
  );
}

export function SpotlightCard({
  className = '',
  order = 0,
  children,
  ...props
}: ComponentProps<typeof CatalogButton> & { order?: number }) {
  return (
    <AnimatedItem index={order} delay={Math.min(order, 7) * 0.025}>
      <ReactBitsSpotlight
        className="recording-spotlight"
        spotlightColor="rgba(197, 246, 138, 0.12)"
      >
        <CatalogButton variant="ghost" {...props} className={className}>
          {children}
        </CatalogButton>
      </ReactBitsSpotlight>
    </AnimatedItem>
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
        <CatalogButton
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
            <FrameImage ratio={1.4} src={r.media_url} alt="" loading="lazy" />
          ) : (
            <FileAudio size={22} />
          )}
          <span>{clock(r.captured_at, timezone)}</span>
        </CatalogButton>
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
      <CatalogButton type="button" className="text-button" onClick={onOpen}>
        {status.failed
          ? `${status.failed.toLocaleString()} need attention`
          : 'View status'}{' '}
        <ArrowRight size={13} />
      </CatalogButton>
    </div>
  );
}
