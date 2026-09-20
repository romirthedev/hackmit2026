'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages -- authenticated originals and workspace links */
import { useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  Image as ImageIcon,
  Link2,
  Search,
  Smartphone,
  Users,
} from 'lucide-react';
import type { Recording, Status } from '@/lib/api';
import type { ConfirmedPerson, ContextGraph, Reminder } from './use-rewind';
import { Card, Cell, Row } from './primitives';

export function recordedWhen(record: Recording, zone?: string) {
  if (record.clock_quality === 'synthetic')
    return record.provenance
      ? `Imported clip · +${record.provenance.source_offset.toFixed(1)}s`
      : 'Imported recording · time unknown';
  return new Date(record.captured_at * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  });
}
export function ClipCard({
  status,
  latest,
  index,
}: {
  status: Status;
  latest?: Recording;
  index: number;
}) {
  return (
    <Cell label="Your recording" index={index}>
      <Card>
        <div className="media-row">
          <div className="device" aria-hidden="true">
            <span className="device-lens" />
            <span className="device-led off" />
          </div>
          <div className="media-meta">
            <div className="card-title">Your phone, your memory</div>
            <p className="muted">
              {latest
                ? `Latest sample: ${recordedWhen(latest, status.timezone)}`
                : 'No recordings yet.'}
            </p>
            <a className="btn mt18" href="/phone">
              <Smartphone /> Open phone recorder
            </a>
          </div>
        </div>
        <div className="track">
          <span
            className="track-fill soft"
            style={{
              width: `${status.received ? Math.min(100, (status.analyzed / status.received) * 100) : 0}%`,
            }}
          />
        </div>
        <Row className="muted xs">
          <span>{status.received} samples saved</span>
          <span>{status.pending} awaiting analysis</span>
        </Row>
        <p className="muted xs mt10">
          Press Record on your phone to begin. Recent uploads do not prove
          continuous coverage.
        </p>
      </Card>
    </Cell>
  );
}

export function TodayCard({
  graph,
  reminders,
  index,
  disabled,
  onSeen,
  onDocument,
}: {
  graph: ContextGraph | null;
  reminders: Reminder[];
  index: number;
  disabled: boolean;
  onSeen: (id: string) => Promise<void>;
  onDocument: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const connected =
    graph?.status.enabled && graph.status.sources.calendar === 'connected';
  const fresh = connected && !graph?.status.stale && !graph?.status.error;
  const upcoming = fresh ? reminders.filter((reminder) => !reminder.seen) : [];
  async function dismiss(id: string) {
    setBusy(id);
    setError('');
    try {
      await onSeen(id);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Cell label="Coming up" index={index}>
      <Card>
        <Row>
          <span className="card-title">Calendar reminders</span>
          <CalendarDays className="icon-muted" />
        </Row>
        {upcoming.length ? (
          <ul className="inbox">
            {upcoming.slice(0, 4).map((reminder) => (
              <li key={reminder.id}>
                <p>{reminder.message}</p>
                <Row>
                  <button
                    className="text-btn"
                    type="button"
                    onClick={() => onDocument(reminder.document_id)}
                  >
                    View appointment
                  </button>
                  <button
                    className="text-btn"
                    type="button"
                    onClick={() => void dismiss(reminder.id)}
                    disabled={disabled || !!busy}
                  >
                    {busy === reminder.id ? 'Saving…' : 'Mark seen'}
                  </button>
                </Row>
              </li>
            ))}
          </ul>
        ) : (
          <p className="serif sm">
            {!connected
              ? 'Connect your calendar to see appointment reminders.'
              : !fresh
                ? 'Calendar updates are unavailable. Open connections to check the sync.'
                : 'No new reminders in the next 30 minutes.'}
          </p>
        )}
        {error && (
          <p role="alert" className="warn">
            {error}
          </p>
        )}
        <a className="text-btn" href="/workspace#context">
          Calendar connections <ArrowUpRight />
        </a>
      </Card>
    </Cell>
  );
}

export function PeopleCard({
  people,
  index,
}: {
  people: ConfirmedPerson[];
  index: number;
}) {
  return (
    <Cell label="People" index={index}>
      <Card>
        <Row>
          <span className="card-title">Faces you confirmed</span>
          <Users className="icon-muted" />
        </Row>
        {people.length ? (
          <ul className="stories">
            {people.slice(0, 4).map((person) => (
              <li key={person.id}>
                <a className="story static" href="/workspace#people">
                  <span className="person-initial" aria-hidden="true">
                    {person.name.slice(0, 1)}
                  </span>
                  <span>
                    <b>{person.name}</b>
                    <small>
                      {person.evidence.length} confirmed{' '}
                      {person.evidence.length === 1 ? 'source' : 'sources'}
                    </small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="serif sm">No faces have been named yet.</p>
        )}
        <p className="muted xs mt10">
          You confirm each name. A similar face is only a possible match.
        </p>
        <a className="text-btn" href="/workspace#people">
          Manage faces &amp; names <ArrowUpRight />
        </a>
      </Card>
    </Cell>
  );
}

export function ConnectionsCard({
  graph,
  index,
}: {
  graph: ContextGraph | null;
  index: number;
}) {
  return (
    <Cell label="Connected life" index={index}>
      <Card>
        <Row>
          <span className="card-title">Your Notch context</span>
          <Link2 className="icon-muted" />
        </Row>
        <div className="kv two">
          {(
            [
              ['notes', 'Notes', 'note'],
              ['calendar', 'Calendar', 'calendar'],
              ['contacts', 'Contacts', 'contact'],
              ['mail', 'Email', 'email'],
            ] as const
          ).map(([key, label, kind]) => (
            <div key={key}>
              <small>{label}</small>
              <b>
                {graph?.status.enabled &&
                graph.status.sources[key] === 'connected'
                  ? `${graph.status.counts[kind] || 0} connected`
                  : (graph?.status.sources[key] || 'Not connected').replaceAll(
                      '_',
                      ' ',
                    )}
              </b>
            </div>
          ))}
        </div>
        {graph?.status.stale && graph.status.enabled && (
          <p className="warn mt10">Saved context needs a fresh sync.</p>
        )}
        {graph?.status.error && (
          <p className="warn mt10">{graph.status.error}</p>
        )}
        <a className="text-btn" href="/workspace#context">
          Manage connections <ArrowUpRight />
        </a>
      </Card>
    </Cell>
  );
}

export function MemoryLogCard({
  records,
  zone,
  index,
  onOpen,
}: {
  records: Recording[];
  zone?: string;
  index: number;
  onOpen: (record: Recording) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = records
    .filter(
      (record) =>
        !query ||
        `${record.summary || ''} ${record.transcript || ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(0, 5);
  return (
    <Cell label="Memory log" index={index}>
      <Card>
        <Row>
          <span className="card-title">Recent samples</span>
          <label className={`search ${query ? 'open' : ''}`}>
            <Search />
            <span className="search-text">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search recent samples"
            />
          </label>
        </Row>
        <ul className="inbox">
          {shown.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                className="source-row"
                onClick={() => onOpen(record)}
              >
                <div className="inbox-head">
                  <b>{record.kind === 'audio' ? 'Audio' : 'Photo'}</b>
                  <span>{recordedWhen(record, zone)}</span>
                </div>
                <p>
                  {record.transcript ||
                    record.summary ||
                    (record.status === 'failed'
                      ? 'Analysis failed; original retained.'
                      : 'Saved, awaiting analysis.')}
                </p>
              </button>
            </li>
          ))}
        </ul>
        {!shown.length && (
          <p className="muted empty">
            {query
              ? 'No recent samples match.'
              : 'No recordings yet. Start with your phone.'}
          </p>
        )}
        {shown.length > 0 && (
          <p className="muted xs mt10">
            Automatic captions and transcripts may contain errors. Open a source
            to check.
          </p>
        )}
      </Card>
    </Cell>
  );
}

export function NoteCard({
  graph,
  index,
  onDocument,
}: {
  graph: ContextGraph | null;
  index: number;
  onDocument: (id: string) => void;
}) {
  const notes = graph?.status.enabled
    ? graph.nodes.filter((node) => node.kind === 'note').slice(0, 4)
    : [];
  return (
    <Cell label="Notes" index={index}>
      <Card>
        <div className="card-title">From your Notch memory</div>
        {notes.length ? (
          <ul className="inbox">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className="source-row"
                  onClick={() => onDocument(note.id)}
                >
                  <p className="serif sm">{note.label}</p>
                  <span className="tag">Open connected note</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="serif sm">No connected notes yet.</p>
        )}
        <a className="text-btn" href="/workspace#context">
          Open memory graph <ArrowUpRight />
        </a>
      </Card>
    </Cell>
  );
}

export function MomentsCard({
  records,
  zone,
  index,
  onOpen,
  arriving,
}: {
  records: Recording[];
  zone?: string;
  index: number;
  onOpen: (record: Recording) => void;
  arriving?: string | null;
}) {
  const frames = records
    .filter((record) => record.kind === 'frame' && record.media_url)
    .slice(0, 4);
  return (
    <Cell label="Moments" index={index}>
      <Card data-card="moments">
        <div className="board">
          {frames.map((record) => (
            <button
              type="button"
              key={record.id}
              data-frame={record.id}
              className={record.id === arriving ? 'is-arriving' : ''}
              onClick={() => onOpen(record)}
              aria-label={`Open photo from ${recordedWhen(record, zone)}`}
            >
              <img
                src={record.media_url}
                alt="Saved camera frame"
                loading="lazy"
              />
            </button>
          ))}
          {!frames.length && (
            <div className="board-empty">
              <ImageIcon />
              <span>No saved photos yet</span>
            </div>
          )}
        </div>
        <Row>
          <div>
            <div className="card-title">A second look</div>
            <div className="muted">Original camera samples</div>
          </div>
          <span className="muted xs">{frames.length} shown</span>
        </Row>
      </Card>
    </Cell>
  );
}

export function HelpCard({ index }: { index: number }) {
  return (
    <Cell label="Your workspace" index={index}>
      <Card>
        <div className="card-title">Do more with Rewind</div>
        <p className="serif sm">Your recordings and your Mac, together.</p>
        <div className="workspace-links">
          <a className="btn" href="/workspace#computer">
            Use your Mac <ArrowUpRight />
          </a>
          <a className="btn" href="/workspace#people">
            Faces &amp; names
          </a>
          <a className="btn" href="/workspace#context">
            Connections
          </a>
          <a className="btn" href="/workspace#usage">
            Usage &amp; devices
          </a>
        </div>
      </Card>
    </Cell>
  );
}
