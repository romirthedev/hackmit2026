'use client';
// Camera originals use authenticated same-origin URLs, without an image optimizer.
/* oxlint-disable next/no-img-element */

import { useRef, useState } from 'react';
import {
  Camera,
  FileAudio,
  LayoutGrid,
  List,
  ChevronRight,
  Clock3,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SpotlightCard, RecordingStatus } from '@/components/memory-details';
import { clock, type Recording } from '@/lib/api';

export function MemoryLibrary({
  records,
  timezone,
  searching,
  onSelect,
}: {
  records: Recording[];
  timezone?: string;
  searching: boolean;
  onSelect: (recording: Recording) => void;
}) {
  const [kind, setKind] = useState('all');
  const [view, setView] = useState('grid');
  const container = useRef<HTMLDivElement>(null);
  const filtered = records.filter((r) => kind === 'all' || r.kind === kind);
  return (
    <>
      <div className="library-toolbar">
        <ToggleGroup
          className="memory-segments"
          value={[kind]}
          onValueChange={(values) => {
            if (values.length) setKind(String(values[0]));
          }}
          aria-label="Filter loaded recordings by type"
        >
          <ToggleGroupItem value="all">
            All <span>{records.length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="frame">
            <Camera size={15} /> Frames{' '}
            <span>{records.filter((r) => r.kind === 'frame').length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="audio">
            <FileAudio size={15} /> Audio{' '}
            <span>{records.filter((r) => r.kind === 'audio').length}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          className="memory-segments view-toggle"
          value={[view]}
          onValueChange={(values) => {
            if (values.length) setView(String(values[0]));
          }}
          aria-label="Recording layout"
        >
          <ToggleGroupItem
            value="grid"
            aria-label="Grid view"
            title="Grid view"
          >
            <LayoutGrid size={16} />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="list"
            aria-label="List view"
            title="List view"
          >
            <List size={18} />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div
        ref={container}
        className={
          'recording-grid ' + (view === 'list' ? 'recording-list' : '')
        }
      >
        {filtered.map((r, i) => (
          <SpotlightCard
            className="recording-card"
            key={r.id}
            order={i}
            onClick={() => onSelect(r)}
            onKeyDown={(e) => {
              if (
                view !== 'list' ||
                !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)
              )
                return;
              const cards = Array.from(
                container.current?.querySelectorAll<HTMLButtonElement>(
                  '.recording-card',
                ) || [],
              );
              const at = cards.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (at < 0) return;
              e.preventDefault();
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? cards.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          cards.length - 1,
                          at + (e.key === 'ArrowDown' ? 1 : -1),
                        ),
                      );
              cards[next]?.focus();
            }}
          >
            {r.kind === 'frame' ? (
              <img loading="lazy" src={r.media_url} alt="" />
            ) : (
              <div className="audio-thumb">
                <FileAudio size={24} />
                <span>Recorded audio</span>
              </div>
            )}
            <div className="recording-card-copy">
              <span className="meta">
                {new Date(r.captured_at * 1000).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  timeZone: timezone,
                })}{' '}
                · {clock(r.captured_at, timezone)}
              </span>
              <p>
                {r.summary ||
                  r.transcript ||
                  (r.status === 'failed'
                    ? 'Analysis needs attention'
                    : 'Saved · waiting for analysis')}
              </p>
              <div className="recording-card-footer">
                <RecordingStatus recording={r} />
                <ChevronRight size={15} />
              </div>
            </div>
          </SpotlightCard>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-line">
          <Clock3 size={24} />
          <strong>
            {kind !== 'all'
              ? `No ${kind === 'frame' ? 'frames' : 'audio'} in these recordings`
              : searching
                ? 'No matching memories'
                : 'Your timeline starts here'}
          </strong>
          <span>
            {kind !== 'all'
              ? 'Choose All to see the other recordings, or load earlier moments.'
              : searching
                ? 'Try fewer words or a wider time range.'
                : 'Your recordings will be collected here, ready to revisit.'}
          </span>
          {kind !== 'all' && (
            <button
              type="button"
              className="text-button"
              onClick={() => setKind('all')}
            >
              Show all recordings
            </button>
          )}
        </div>
      )}
    </>
  );
}
