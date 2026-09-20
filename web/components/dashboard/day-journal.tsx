'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages -- authenticated originals and static-export navigation */
import {
  ArrowUpRight,
  AudioLines,
  Camera,
  Monitor,
  Users,
  Link2,
} from 'lucide-react';
import type { Recording, Status } from '@/lib/api';
import { recordedWhen } from './rose-cards';

export function DayJournal({
  records,
  status,
  onOpen,
}: {
  records: Recording[];
  status: Status;
  onOpen: (record: Recording) => void;
}) {
  const latest = records.find(
    (record) => record.kind === 'frame' && record.media_url,
  );
  const earlier = records
    .filter((record) => record.id !== latest?.id)
    .slice(0, 5);
  return (
    <section className="day-journal" aria-label="Recent recordings">
      <div className="journal-section-heading">
        <h2>Recent recordings</h2>
        <a href="/workspace">
          View all <ArrowUpRight />
        </a>
      </div>
      {latest ? (
        <figure className="journal-feature">
          <button
            type="button"
            className="journal-photo"
            onClick={() => onOpen(latest)}
            aria-label="Open latest recorded photo"
          >
            <img src={latest.media_url} alt="Latest saved camera frame" />
            <span className="journal-photo-label">
              <span>Latest capture</span>
              <ArrowUpRight />
            </span>
          </button>
          <figcaption>
            <span className="journal-timestamp">
              {recordedWhen(latest, status.timezone)}
            </span>
            <p>{latest.summary || 'Original saved. Description pending.'}</p>
            <span className="journal-description-note">
              Automatic description · open to inspect the original
            </span>
          </figcaption>
        </figure>
      ) : (
        <div className="journal-empty">
          <Camera aria-hidden="true" />
          <h3>
            {records.length
              ? 'Your audio is saved below.'
              : 'Start with a moment.'}
          </h3>
          <p>
            {records.length
              ? 'Camera images will appear here when you record on your phone.'
              : 'Open Rewind on your phone and press Record. Your saved moments will appear here.'}
          </p>
          <a href="/phone">
            Open phone recorder <ArrowUpRight />
          </a>
        </div>
      )}
      {earlier.length > 0 && (
        <div className="journal-history">
          <div className="journal-history-heading">
            <h3>{latest ? 'Earlier' : 'Saved audio'}</h3>
            <span>Most recent first</span>
          </div>
          <ol>
            {earlier.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className="journal-entry"
                  onClick={() => onOpen(record)}
                >
                  <span className="journal-thumb">
                    {record.kind === 'frame' && record.media_url ? (
                      <img src={record.media_url} alt="" loading="lazy" />
                    ) : (
                      <AudioLines />
                    )}
                  </span>
                  <span className="journal-entry-copy">
                    <span className="journal-timestamp">
                      {recordedWhen(record, status.timezone)}
                      {record.kind === 'audio' ? ' · Audio' : ''}
                    </span>
                    <span className="journal-caption">
                      {record.transcript ||
                        record.summary ||
                        (record.status === 'failed'
                          ? 'Analysis unavailable. Original retained.'
                          : 'Saved. Waiting for analysis.')}
                    </span>
                  </span>
                  <ArrowUpRight className="journal-entry-arrow" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="journal-storage-note">
        <span>{status.received.toLocaleString()} saved samples</span>
        <span>
          {status.pending
            ? `${status.pending} waiting for analysis`
            : 'Originals retained'}
        </span>
      </div>
    </section>
  );
}

export function WorkspaceLinks({ peopleCount }: { peopleCount: number }) {
  return (
    <nav className="journal-tools" aria-label="Workspace tools">
      <a href="/workspace#computer">
        <Monitor />
        <span>
          <strong>Your Mac</strong>
          <small>Requests &amp; activity</small>
        </span>
        <ArrowUpRight />
      </a>
      <a href="/workspace#people">
        <Users />
        <span>
          <strong>People</strong>
          <small>
            {peopleCount
              ? `${peopleCount} confirmed ${peopleCount === 1 ? 'person' : 'people'}`
              : 'Manage faces & names'}
          </small>
        </span>
        <ArrowUpRight />
      </a>
      <a href="/workspace#context">
        <Link2 />
        <span>
          <strong>Connected sources</strong>
          <small>Calendar, notes &amp; contacts</small>
        </span>
        <ArrowUpRight />
      </a>
    </nav>
  );
}
