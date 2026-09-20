'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages -- authenticated originals and workspace/download links */
import { useState } from 'react';
import {
  Aperture,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  Cpu,
  Download,
  HardDrive,
  Pause,
  Play,
  Plus,
  RefreshCw,
  MessageCircle,
  X,
} from 'lucide-react';
import {
  bytes,
  type Alert,
  type Answer,
  type Recording,
  type Rule,
  type Status,
} from '@/lib/api';
import { Btn, Card, Cell, Row, ago, hm } from './primitives';
import { AnswerDetail, answerState } from './answer-detail';
import { recordedWhen } from './rose-cards';

export function OverviewCard({
  status,
  latest,
  alerts,
  index,
  onAsk,
}: {
  status: Status;
  latest?: Recording;
  alerts: Alert[];
  index: number;
  onAsk: () => void;
}) {
  const unread = alerts.filter((alert) => !alert.seen).length;
  return (
    <Cell label="Shared overview" wide index={index}>
      <Card className={`card-hero ${unread ? 'attention' : ''}`}>
        <div className="hero-body">
          <div className="hero-head">
            <div>
              <h2 className="hero-title">Recording activity</h2>
              <p className="muted">
                {latest
                  ? `Latest sample: ${recordedWhen(latest, status.timezone)}.`
                  : 'Start recording on your phone to build a memory.'}{' '}
                Saved samples do not establish a person’s current location or
                wellbeing.
              </p>
            </div>
          </div>
          <div className="hero-stats">
            {[
              ['Saved samples', status.received],
              ['Analyzed', status.analyzed],
              ['Waiting', status.pending],
              ['New alerts', unread],
            ].map(([label, value]) => (
              <div key={label} className="stat">
                <span>
                  <small>{label}</small>
                  <b>{value}</b>
                </span>
              </div>
            ))}
          </div>
          <div className="hero-actions">
            <Btn onClick={onAsk}>
              <MessageCircle /> Ask about the day
            </Btn>
            <a className="btn ghost" href="/workspace#context">
              <ArrowUpRight /> Connected context
            </a>
          </div>
        </div>
      </Card>
    </Cell>
  );
}

export function WatchCard({
  rules,
  alerts,
  zone,
  onAdd,
  onRemove,
  onSeen,
  index,
  disabled,
}: {
  rules: Rule[];
  alerts: Alert[];
  zone?: string;
  onAdd: (instruction: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSeen: (id: string) => Promise<void>;
  index: number;
  disabled: boolean;
}) {
  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unread = alerts.filter((alert) => !alert.seen).length;
  async function change(action: () => Promise<void>, after?: () => void) {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await action();
      after?.();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Cell label="Watch for me" index={index}>
      <Card>
        <Row>
          <span className="card-title">
            Observations{' '}
            {unread > 0 && <span className="count-bubble">{unread}</span>}
          </span>
          <div className="mini-seg">
            <button
              type="button"
              className={tab === 'alerts' ? 'is-active' : ''}
              onClick={() => setTab('alerts')}
            >
              Alerts
            </button>
            <button
              type="button"
              className={tab === 'rules' ? 'is-active' : ''}
              onClick={() => setTab('rules')}
            >
              Rules
            </button>
          </div>
        </Row>
        {tab === 'alerts' ? (
          <ul className="inbox alerts">
            {alerts.slice(0, 4).map((alert) => (
              <li key={alert.id} className={alert.seen ? '' : 'unread'}>
                <div className="inbox-head">
                  <b>{alert.seen ? 'Seen' : 'New'}</b>
                  <span>{hm(alert.created_at, zone)}</span>
                </div>
                <p>{alert.message}</p>
                <Row>
                  <a
                    className="text-btn"
                    href={`/api/media/${encodeURIComponent(alert.event_id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original source
                  </a>
                  {!alert.seen && (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => void change(() => onSeen(alert.id))}
                      disabled={busy || disabled}
                    >
                      <Check /> Mark as seen
                    </button>
                  )}
                </Row>
              </li>
            ))}
            {!alerts.length && (
              <li className="none">
                <BellOff /> No recorded alerts yet.
              </li>
            )}
          </ul>
        ) : (
          <ul className="rules">
            {rules.map((rule) => (
              <li key={rule.id}>
                <span className="rule-dot" />
                <span>
                  {rule.instruction}
                  {!rule.enabled && ' (disabled)'}
                </span>
                <button
                  type="button"
                  className="tbtn xs"
                  aria-label={`Remove rule: ${rule.instruction}`}
                  onClick={() => void change(() => onRemove(rule.id))}
                  disabled={busy || disabled}
                >
                  <X />
                </button>
              </li>
            ))}
            {!rules.length && (
              <li className="none">No rules yet. Add one below.</li>
            )}
          </ul>
        )}
        <form
          className="add-rule"
          onSubmit={(event) => {
            event.preventDefault();
            const instruction = text.trim();
            if (instruction)
              void change(
                () => onAdd(instruction),
                () => {
                  setText('');
                  setTab('rules');
                },
              );
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Tell me if…"
            aria-label="New monitoring rule"
            maxLength={1000}
            disabled={disabled || busy}
          />
          <button
            type="submit"
            className="tbtn tbtn-solid"
            aria-label="Add rule"
            disabled={disabled || busy || !text.trim()}
          >
            <Plus />
          </button>
        </form>
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <p className="muted xs mt10">
          Alerts are model interpretations of recorded samples. Open their
          source to check.
        </p>
      </Card>
    </Cell>
  );
}

export function DeviceCard({
  status,
  online,
  now,
  onPause,
  index,
  disabled,
}: {
  status: Status;
  online: boolean;
  now: number;
  onPause: (paused: boolean) => Promise<void>;
  index: number;
  disabled: boolean;
}) {
  const device = status.devices[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function pause() {
    setBusy(true);
    setError('');
    try {
      await onPause(!status.paused);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Cell label="Devices" index={index}>
      <Card>
        <Row>
          <span className="card-title">
            {device?.id || 'Phone-first recording'}
          </span>
          {device && (
            <span className={`status-dot ${online ? 'ok' : ''}`}>
              {online ? 'Recent heartbeat' : 'No recent heartbeat'}
            </span>
          )}
        </Row>
        {device ? (
          <>
            <div className="kv two">
              <div>
                <small>Last heartbeat</small>
                <b>{ago(now - device.last_seen)}</b>
              </div>
              <div>
                <small>Queued on device</small>
                <b>{device.state.queued}</b>
              </div>
              <div>
                <small>Dropped samples</small>
                <b>{device.state.dropped}</b>
              </div>
              <div>
                <small>Device storage free</small>
                <b>{bytes(device.state.free_sd_bytes)}</b>
              </div>
            </div>
            {device.state.error && <p className="warn">{device.state.error}</p>}
            <Btn
              className="mt18"
              onClick={() => void pause()}
              disabled={disabled || busy}
            >
              {status.paused ? <Play /> : <Pause />}
              {busy
                ? 'Updating…'
                : status.paused
                  ? 'Resume hardware capture'
                  : 'Pause hardware capture'}
            </Btn>
          </>
        ) : (
          <p className="serif sm">
            Open the recorder on your phone. Hardware devices appear here when
            they send a heartbeat.
          </p>
        )}
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <a className="text-btn" href="/workspace#usage">
          Pair a phone or review devices <ArrowUpRight />
        </a>
      </Card>
    </Cell>
  );
}

export function ProcessingCard({
  status,
  onRetry,
  index,
  disabled,
}: {
  status: Status;
  onRetry: () => Promise<void>;
  index: number;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const total = Math.max(1, status.received);
  async function retry() {
    setBusy(true);
    setError('');
    try {
      await onRetry();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Cell label="Memory" index={index}>
      <Card>
        <Row>
          <span className="card-title">Processing</span>
          <Cpu className="icon-muted" />
        </Row>
        <div className="big-num">
          {status.analyzed.toLocaleString()}
          <small>samples analyzed</small>
        </div>
        <div className="segbar">
          <span
            className="sb-ok"
            style={{ width: `${(status.analyzed / total) * 100}%` }}
          />
          <span
            className="sb-pend"
            style={{ width: `${(status.pending / total) * 100}%` }}
          />
          <span
            className="sb-fail"
            style={{ width: `${(status.failed / total) * 100}%` }}
          />
        </div>
        <div className="legend">
          <span>
            <i className="sb-ok" />
            {status.analyzed} analyzed
          </span>
          <span>
            <i className="sb-pend" />
            {status.pending} pending
          </span>
          <span>
            <i className="sb-fail" />
            {status.failed} failed
          </span>
        </div>
        <p className="muted mt10">
          {status.analysis_ready === false
            ? 'Analysis is unavailable. Saved originals remain in the workspace.'
            : 'Descriptions support retrieval; answers still need evidence review.'}
        </p>
        <div className="kv two">
          <div>
            <small>Average sample analysis</small>
            <b>
              {status.average_analysis_ms !== null
                ? `${(status.average_analysis_ms / 1000).toFixed(1)}s`
                : '—'}
            </b>
          </div>
          <div>
            <small>Stored samples</small>
            <b>{bytes(status.stored_bytes)}</b>
          </div>
        </div>
        {status.failed > 0 && (
          <Btn
            className="mt18"
            onClick={() => void retry()}
            disabled={busy || disabled}
          >
            <RefreshCw />
            {busy ? 'Retrying…' : `Retry ${status.failed} failed samples`}
          </Btn>
        )}
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <a className="text-btn" href="/workspace#usage">
          Usage &amp; processing details <ArrowUpRight />
        </a>
      </Card>
    </Cell>
  );
}

export function LatestCard({
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
  const frames = records.filter(
    (record) => record.kind === 'frame' && record.media_url,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const current = frames.find((frame) => frame.id === selected) || frames[0];
  return (
    <Cell label="Latest capture" index={index}>
      <Card className="card-photo" data-card="moments">
        {current ? (
          <>
            <button
              type="button"
              className={`photo ${current.id === arriving ? 'is-arriving' : ''}`}
              data-frame={current.id}
              onClick={() => onOpen(current)}
              aria-label="Open latest original photo"
            >
              <img src={current.media_url} alt="Original camera sample" />
            </button>
            <div className="photo-foot">
              <div>
                <div className="card-title">{recordedWhen(current, zone)}</div>
                <div className="muted">
                  {current.summary || 'Saved original; description not ready.'}
                </div>
                <small className="muted">Automatic caption · unverified</small>
              </div>
            </div>
            <div className="strip">
              {frames.slice(0, 6).map((frame) => (
                <button
                  key={frame.id}
                  type="button"
                  className={frame.id === current.id ? 'is-sel' : ''}
                  onClick={() => setSelected(frame.id)}
                  aria-label={`Select photo ${recordedWhen(frame, zone)}`}
                >
                  <img src={frame.media_url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="board-empty tall">
            <Aperture />
            <span>No saved photos yet. Start recording on your phone.</span>
          </div>
        )}
      </Card>
    </Cell>
  );
}

export function QuestionsCard({
  answers,
  zone,
  index,
  onOpen,
}: {
  answers: Answer[];
  zone?: string;
  index: number;
  onOpen: (record: Recording) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Cell label="Questions" index={index}>
      <Card>
        <Row>
          <span className="card-title">Recent questions</span>
          <Bell className="icon-muted" />
        </Row>
        <ul className="qa-list">
          {answers.slice(0, 4).map((answer) => (
            <li key={answer.id} className={open === answer.id ? 'open' : ''}>
              <button
                type="button"
                onClick={() => setOpen(open === answer.id ? null : answer.id)}
                aria-label={`Read answer: ${answer.question}`}
                aria-expanded={open === answer.id}
              >
                <span className="q">
                  <b>{answer.question}</b>
                  <small>
                    {hm(answer.created_at, zone)} · {answerState(answer)}
                  </small>
                </span>
              </button>
              {open === answer.id && (
                <AnswerDetail answer={answer} onOpen={onOpen} />
              )}
            </li>
          ))}
          {!answers.length && (
            <li className="none">
              No questions yet. Ask about something you recorded.
            </li>
          )}
        </ul>
      </Card>
    </Cell>
  );
}

export function DataCard({ status, index }: { status: Status; index: number }) {
  return (
    <Cell label="Your data" index={index}>
      <Card>
        <Row>
          <span className="card-title">Saved in your workspace</span>
          <HardDrive className="icon-muted" />
        </Row>
        <p className="muted mt10">
          Keep original recordings and inspect the sources behind each answer.
          Analysis and review can use connected AI services.
        </p>
        <div className="kv two">
          <div>
            <small>Samples saved</small>
            <b>{status.received.toLocaleString()}</b>
          </div>
          <div>
            <small>Server storage free</small>
            <b>{bytes(status.free_bytes)}</b>
          </div>
        </div>
        <div className="workspace-links mt18">
          <a className="btn" href="/api/export">
            <Download /> Export metadata
          </a>
          <a className="btn ghost" href="/workspace#usage">
            Storage &amp; usage <ArrowUpRight />
          </a>
        </div>
      </Card>
    </Cell>
  );
}
