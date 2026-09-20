'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages -- scanned originals are authenticated media */
import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Mail,
  Printer,
  Receipt,
  RotateCcw,
  Stamp,
  Trash2,
} from 'lucide-react';
import type { ScanDocument } from '@/lib/api';
import type { ContextGraph, Reminder } from './use-rewind';
import { Card, Cell, Row } from './primitives';

export const isPostcard = (document: ScanDocument) =>
  document.kind === 'postcard' || document.kind === 'letter';
export const isBill = (document: ScanDocument) =>
  document.kind === 'bill' || document.kind === 'appointment';

export function prettyDate(iso: string, style: 'long' | 'short' = 'long') {
  try {
    return format(parseISO(iso), style === 'long' ? 'MMMM d, yyyy' : 'MMM d');
  } catch {
    return iso;
  }
}

// The message side of a postcard. `mini` is the version that rides inside
// the envelope during the arrival animation.
export function PostcardBack({
  document,
  mini = false,
}: {
  document: ScanDocument;
  mini?: boolean;
}) {
  const place = document.place || 'Portland, Oregon';
  return (
    <div className={`postcard-back ${mini ? 'is-mini' : ''}`}>
      <div className="pc-message">
        <p className="pc-date">{prettyDate(document.date)}</p>
        <p className="pc-text">{document.message}</p>
      </div>
      <div className="pc-divider" aria-hidden="true" />
      <div className="pc-right">
        <div className="pc-stamp" aria-hidden="true">
          <span className="pc-stamp-inner">
            <i className="pc-stamp-sun" />
            <i className="pc-stamp-hill" />
          </span>
        </div>
        <div className="pc-postmark" aria-hidden="true">
          <span>{place.split(',')[0]}</span>
          <small>{prettyDate(document.date, 'short')}</small>
        </div>
        <div className="pc-address">
          <span>
            {document.recipient === 'Mom'
              ? 'Rose Whitaker'
              : document.recipient}
          </span>
          <span>14 Orchard Lane</span>
          <span>Boston, MA 02116</span>
        </div>
      </div>
    </div>
  );
}

// The picture side: the scanned photo when we have one, otherwise a drawn view.
export function PostcardFront({
  document,
  mini = false,
}: {
  document: ScanDocument;
  mini?: boolean;
}) {
  const place = (document.place || 'Portland').split(',')[0];
  return (
    <div className={`postcard-front ${mini ? 'is-mini' : ''}`}>
      {document.image_url ? (
        <img src={document.image_url} alt="Scanned postcard" />
      ) : (
        <div className="pc-scene" aria-hidden="true">
          <i className="pc-sun" />
          <i className="pc-mtn a" />
          <i className="pc-mtn b" />
          <i className="pc-trees" />
        </div>
      )}
      <span className="pc-greeting">
        <small>greetings from</small>
        {place}
      </span>
    </div>
  );
}

export function BillSlip({
  document,
  mini = false,
}: {
  document: ScanDocument;
  mini?: boolean;
}) {
  return (
    <div className={`bill-slip ${mini ? 'is-mini' : ''}`}>
      <div className="bill-head">
        <span className="bill-cross" aria-hidden="true" />
        <div>
          <b>{document.title}</b>
          <small>{document.sender}</small>
        </div>
      </div>
      <div className="bill-body">
        <div className="bill-line">
          <span>Amount due</span>
          <b>{document.amount || '—'}</b>
        </div>
        <div className="bill-line">
          <span>Due by</span>
          <b className="bill-due">
            {document.due_date ? prettyDate(document.due_date) : 'No date read'}
          </b>
        </div>
        {!mini && <p className="bill-note">{document.message}</p>}
      </div>
    </div>
  );
}

export function LettersCard({
  scans,
  graph,
  index,
  arriving,
  onOpen,
  onDocument,
}: {
  scans: ScanDocument[];
  graph: ContextGraph | null;
  index: number;
  arriving?: string | null;
  onOpen: (document: ScanDocument) => void;
  onDocument: (id: string) => void;
}) {
  const letters = scans.filter(isPostcard);
  // The stack is keyed by the newest letter: when a new postcard arrives the
  // view resets to it, message side up.
  const newest = letters[0]?.id ?? '';
  const [position, setPosition] = useState({
    key: newest,
    index: 0,
    flipped: false,
  });
  const current = position.key === newest ? position.index : 0;
  const flipped = position.key === newest ? position.flipped : false;
  const setCurrent = (update: (value: number) => number) =>
    setPosition({ key: newest, index: update(current), flipped: false });
  const setFlipped = (update: (value: boolean) => boolean) =>
    setPosition({ key: newest, index: current, flipped: update(flipped) });
  const notes = graph?.status.enabled
    ? graph.nodes.filter((node) => node.kind === 'note').slice(0, 2)
    : [];
  const shown = letters[Math.min(current, Math.max(0, letters.length - 1))];
  return (
    <Cell label="Letters" index={index}>
      <Card data-card="letters">
        <Row>
          <span className="card-title">
            {letters.length
              ? `From ${shown?.sender || 'family'}`
              : 'Nothing in the mailbox yet'}
          </span>
          <Mail className="icon-muted" />
        </Row>
        <div className="letter-stack" data-slot="postcard">
          {shown ? (
            <>
              {letters.length > 1 && (
                <span className="letter-under" aria-hidden="true" />
              )}
              <button
                type="button"
                className={`postcard ${flipped ? 'is-flipped' : ''} ${shown.id === arriving ? 'is-arriving' : ''}`}
                onClick={() => setFlipped((value) => !value)}
                aria-label={
                  flipped ? 'Show the message' : 'Show the picture side'
                }
              >
                <div className="postcard-face front">
                  <PostcardBack document={shown} />
                </div>
                <div className="postcard-face back">
                  <PostcardFront document={shown} />
                </div>
              </button>
            </>
          ) : (
            <div className="letter-empty">
              <Stamp />
              <span>
                Scan a postcard on your phone and it lands here, message side
                up.
              </span>
            </div>
          )}
        </div>
        {shown && (
          <Row className="letter-tools">
            <span className="muted xs">
              {prettyDate(shown.date)} · tap the card to turn it over
            </span>
            <span className="letter-nav">
              {letters.length > 1 && (
                <>
                  <button
                    type="button"
                    className="tbtn xs"
                    aria-label="Older letter"
                    disabled={current >= letters.length - 1}
                    onClick={() => {
                      setCurrent((value) => value + 1);
                      setFlipped(() => false);
                    }}
                  >
                    <ChevronLeft />
                  </button>
                  <small className="muted xs tabular">
                    {current + 1}/{letters.length}
                  </small>
                  <button
                    type="button"
                    className="tbtn xs"
                    aria-label="Newer letter"
                    disabled={current === 0}
                    onClick={() => {
                      setCurrent((value) => value - 1);
                      setFlipped(() => false);
                    }}
                  >
                    <ChevronRight />
                  </button>
                </>
              )}
              <button
                type="button"
                className="tbtn xs"
                aria-label="Open the scanned original"
                onClick={() => onOpen(shown)}
              >
                <RotateCcw />
              </button>
            </span>
          </Row>
        )}
        {notes.length > 0 && (
          <ul className="inbox mt10">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className="source-row"
                  onClick={() => onDocument(note.id)}
                >
                  <p className="serif sm">{note.label}</p>
                  <span className="tag">Connected note</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Cell>
  );
}

type CalendarEvent = {
  id: string;
  day: Date;
  title: string;
  detail: string;
  kind: 'bill' | 'appointment' | 'reminder';
  document?: ScanDocument;
  reminder?: Reminder;
};

export function CalendarCard({
  scans,
  reminders,
  graph,
  index,
  zone,
  arriving,
  disabled,
  onOpen,
  onDocument,
  onSeen,
}: {
  scans: ScanDocument[];
  reminders: Reminder[];
  graph: ContextGraph | null;
  index: number;
  zone?: string;
  arriving?: string | null;
  disabled: boolean;
  onOpen: (document: ScanDocument) => void;
  onDocument: (id: string) => void;
  onSeen: (id: string) => Promise<void>;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const events = useMemo<CalendarEvent[]>(() => {
    const items: CalendarEvent[] = [];
    for (const document of scans)
      if (isBill(document) && document.due_date) {
        try {
          items.push({
            id: document.id,
            day: parseISO(document.due_date),
            title:
              document.kind === 'bill'
                ? `${document.amount || 'Bill'} · ${document.title}`
                : document.title,
            detail:
              document.kind === 'bill'
                ? `Pay ${document.sender || document.title}`
                : document.message,
            kind: document.kind === 'bill' ? 'bill' : 'appointment',
            document,
          });
        } catch {}
      }
    const connected =
      graph?.status.enabled && graph.status.sources.calendar === 'connected';
    if (connected)
      for (const reminder of reminders)
        items.push({
          id: reminder.id,
          day: new Date(reminder.starts_at * 1000),
          title: reminder.message,
          detail: new Date(reminder.starts_at * 1000).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: zone,
          }),
          kind: 'reminder',
          reminder,
        });
    return items.sort((a, b) => a.day.getTime() - b.day.getTime());
  }, [scans, reminders, graph, zone]);
  // Follow a bill to its month as it lands.
  const landing = events.find((event) => event.id === arriving);
  const [followed, setFollowed] = useState<string | null>(null);
  if (landing && followed !== landing.id) {
    setFollowed(landing.id);
    setMonth(startOfMonth(landing.day));
    setSelected(landing.day);
  }
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  });
  const onDay = (day: Date) =>
    events.filter((event) => isSameDay(event.day, day));
  const focus = selected ?? new Date();
  const listed = selected
    ? onDay(selected)
    : events
        .filter(
          (event) => event.day >= new Date(new Date().setHours(0, 0, 0, 0)),
        )
        .slice(0, 3);
  async function markSeen(id: string) {
    setBusy(id);
    try {
      await onSeen(id);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Cell label="Coming up" index={index}>
      <Card data-card="calendar">
        <Row>
          <span className="card-title">{format(month, 'MMMM yyyy')}</span>
          <span className="cal-nav">
            <button
              type="button"
              className="tbtn xs"
              aria-label="Previous month"
              onClick={() => setMonth((value) => addMonths(value, -1))}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              className="tbtn xs"
              aria-label="This month"
              onClick={() => {
                setMonth(startOfMonth(new Date()));
                setSelected(null);
              }}
            >
              <CalendarDays />
            </button>
            <button
              type="button"
              className="tbtn xs"
              aria-label="Next month"
              onClick={() => setMonth((value) => addMonths(value, 1))}
            >
              <ChevronRight />
            </button>
          </span>
        </Row>
        <div className="cal-grid" aria-label="Month">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => (
            <span key={i} className="cal-dow" aria-hidden="true">
              {label}
            </span>
          ))}
          {days.map((day) => {
            const here = onDay(day);
            const iso = format(day, 'yyyy-MM-dd');
            const hasBill = here.some((event) => event.kind === 'bill');
            return (
              <button
                type="button"
                key={iso}
                data-day={iso}
                aria-pressed={selected ? isSameDay(day, selected) : undefined}
                aria-label={format(day, 'EEEE, MMMM d')}
                className={[
                  'cal-day',
                  isSameMonth(day, month) ? '' : 'is-out',
                  isToday(day) ? 'is-today' : '',
                  selected && isSameDay(day, selected) ? 'is-selected' : '',
                  here.length ? 'has-event' : '',
                  hasBill ? 'has-bill' : '',
                  here.some((event) => event.id === arriving)
                    ? 'is-landing'
                    : '',
                ].join(' ')}
                onClick={() =>
                  setSelected((value) =>
                    value && isSameDay(value, day) ? null : day,
                  )
                }
              >
                <span>{format(day, 'd')}</span>
                {here.length > 0 && (
                  <i className="cal-dots" aria-hidden="true">
                    {here.slice(0, 3).map((event) => (
                      <b key={event.id} className={`dot-${event.kind}`} />
                    ))}
                  </i>
                )}
              </button>
            );
          })}
        </div>
        <div className="cal-list">
          <p className="muted xs">
            {selected
              ? format(focus, 'EEEE, MMMM d')
              : listed.length
                ? 'Next up'
                : 'Nothing scheduled yet'}
          </p>
          {listed.length ? (
            <ul className="inbox">
              {listed.map((event) => (
                <li key={event.id} className={`cal-event kind-${event.kind}`}>
                  <button
                    type="button"
                    className="source-row"
                    onClick={() =>
                      event.document
                        ? onOpen(event.document)
                        : event.reminder &&
                          onDocument(event.reminder.document_id)
                    }
                  >
                    <div className="inbox-head">
                      <b>
                        {event.kind === 'bill' ? <Receipt /> : <CalendarDays />}
                        {event.title}
                      </b>
                      <span>{format(event.day, 'MMM d')}</span>
                    </div>
                    <p>{event.detail}</p>
                  </button>
                  {event.reminder && !event.reminder.seen && (
                    <button
                      type="button"
                      className="text-btn"
                      disabled={disabled || !!busy}
                      onClick={() => void markSeen(event.reminder!.id)}
                    >
                      {busy === event.reminder.id ? 'Saving…' : 'Mark seen'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="serif sm">
              {selected
                ? 'A free day.'
                : 'Scan a bill or connect your calendar and dates show up here.'}
            </p>
          )}
        </div>
      </Card>
    </Cell>
  );
}

export function MailCard({
  scans,
  index,
  disabled,
  onOpen,
  onRemove,
  onDemo,
}: {
  scans: ScanDocument[];
  index: number;
  disabled: boolean;
  onOpen: (document: ScanDocument) => void;
  onRemove: (id: string) => Promise<void>;
  onDemo: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Cell label="Scanned mail" index={index}>
      <Card>
        <Row>
          <span className="card-title">What Rose scanned</span>
          <a
            className="text-btn"
            href="/print"
            target="_blank"
            rel="noreferrer"
          >
            <Printer /> Print demo mail
          </a>
        </Row>
        {scans.length ? (
          <ul className="inbox">
            {scans.slice(0, 6).map((document) => (
              <li key={document.id}>
                <div className="inbox-head">
                  <b>
                    {isBill(document) ? <Receipt /> : <Mail />}
                    {document.title}
                  </b>
                  <span>
                    {new Date(document.created_at * 1000).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p>
                  {isBill(document)
                    ? `${document.amount || 'Amount unread'} due ${document.due_date ? prettyDate(document.due_date) : 'date unread'}`
                    : document.message}
                </p>
                <Row>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => onOpen(document)}
                  >
                    Open
                  </button>
                  <span className="muted xs">
                    {document.source === 'model'
                      ? 'read by the model'
                      : document.source === 'template'
                        ? 'filled from the printed demo'
                        : 'model + printed demo'}
                  </span>
                  <button
                    type="button"
                    className="tbtn xs"
                    aria-label="Remove this scan"
                    disabled={disabled || busy}
                    onClick={() => void run(() => onRemove(document.id))}
                  >
                    <Trash2 />
                  </button>
                </Row>
              </li>
            ))}
          </ul>
        ) : (
          <p className="serif sm">No mail scanned yet.</p>
        )}
        <button
          type="button"
          className="btn sm mt10"
          disabled={disabled || busy}
          onClick={() => void run(onDemo)}
        >
          {busy ? 'Filing…' : 'File the printed demo mail'}
        </button>
        <p className="muted xs mt10">
          Rehearse the hand-off without a phone: this files the postcard and
          bill from the print page as if they had just been scanned.
        </p>
      </Card>
    </Cell>
  );
}
