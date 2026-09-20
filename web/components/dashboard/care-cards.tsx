'use client';
/* oxlint-disable next/no-img-element, next/no-html-link-for-pages -- plain links keep the export download and the dark workspace outside the client router */
import { useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  Cpu,
  Download,
  HardDrive,
  Home,
  Mic,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Smile,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
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
import { Avatar, Btn, Card, Cell, Row, ago, hm } from './primitives';
import {
  ADHERENCE,
  MEDS,
  PEOPLE,
  ROSE_AVATAR,
  WEEK_SLEEP,
  WEEK_STEPS,
} from './demo-data';

// Rose, right now (hero, spans two columns) -----------------------------
export function RoseHeroCard({
  status,
  online,
  now,
  records,
  alerts,
  index,
  onAsk,
}: {
  status: Status;
  online: boolean;
  now: number;
  records: Recording[];
  alerts: Alert[];
  index: number;
  onAsk: () => void;
}) {
  const last = records[0];
  const lastSeen =
    status.last_capture && now
      ? ago(now - status.last_capture)
      : 'no capture yet';
  const unread = alerts.filter((a) => !a.seen).length;
  const mood = unread ? 'Needs a look' : 'Doing well';
  const place = last?.objects?.[0]?.location || last?.tags?.[0] || 'at home';
  const stats = [
    { icon: <Home />, k: 'Where', v: place[0].toUpperCase() + place.slice(1) },
    { icon: <Smile />, k: 'Mood', v: 'Cheerful' },
    { icon: <Moon />, k: 'Sleep', v: '7h 24m' },
    {
      icon: online ? <Wifi /> : <WifiOff />,
      k: 'Clip',
      v: online ? (status.paused ? 'Paused' : 'Recording') : 'Offline',
    },
  ];
  return (
    <Cell label="Rose, right now" wide index={index}>
      <Card className={`card-hero ${unread ? 'attention' : ''}`}>
        <div className="hero-figure">
          <div className="hero-ring" />
          <img
            src={ROSE_AVATAR}
            alt="Illustration of Rose"
            width={220}
            height={220}
          />
          <span
            className={`hero-badge ${online && !status.paused ? 'is-live' : ''}`}
          >
            <i />
            {online ? (status.paused ? 'Capture paused' : 'Live') : 'Offline'}
          </span>
        </div>
        <div className="hero-body">
          <div className="hero-head">
            <div>
              <h2 className="hero-title">{mood}</h2>
              <p className="muted">
                Last capture {lastSeen}
                {last ? ` · ${hm(last.captured_at, status.timezone)}` : ''}.{' '}
                {last?.summary ? last.summary : 'Everything looks normal.'}
              </p>
            </div>
          </div>
          <div className="hero-stats">
            {stats.map((s) => (
              <div key={s.k} className="stat">
                {s.icon}
                <span>
                  <small>{s.k}</small>
                  <b>{s.v}</b>
                </span>
              </div>
            ))}
          </div>
          <div className="hero-actions">
            <Btn onClick={onAsk}>
              <Sparkles />
              Ask about her day
            </Btn>
            <Btn className="ghost">
              <Send />
              Send a note
            </Btn>
            {unread > 0 && (
              <span className="pill-alert">
                <Bell />
                {unread} new {unread === 1 ? 'alert' : 'alerts'}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Cell>
  );
}

// Watch for me: monitoring rules + live alerts ---------------------------
export function WatchCard({
  rules,
  alerts,
  zone,
  onAdd,
  onRemove,
  onSeen,
  index,
}: {
  rules: Rule[];
  alerts: Alert[];
  zone?: string;
  onAdd: (s: string) => void;
  onRemove: (id: string) => void;
  onSeen: (id: string) => void;
  index: number;
}) {
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts');
  const unread = alerts.filter((a) => !a.seen).length;
  const suggestions = [
    'Stove left on',
    'Door open after 9 PM',
    'A fall or long stillness',
  ];
  return (
    <Cell label="Watch for me" index={index}>
      <Card>
        <Row>
          <span className="card-title">
            Watch for me{' '}
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
            {alerts.slice(0, 4).map((a) => (
              <li key={a.id} className={a.seen ? '' : 'unread'}>
                <div className="inbox-head">
                  <b>{a.seen ? 'Noticed' : 'New'}</b>
                  <span>{hm(a.created_at, zone)}</span>
                </div>
                <p>{a.message}</p>
                {!a.seen && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => onSeen(a.id)}
                  >
                    <Check />
                    Mark as seen
                  </button>
                )}
              </li>
            ))}
            {!alerts.length && (
              <li className="none">
                <BellOff />
                Nothing to report. Rules run on every new capture.
              </li>
            )}
          </ul>
        ) : (
          <ul className="rules">
            {rules.map((r) => (
              <li key={r.id}>
                <span className="rule-dot" />
                <span>{r.instruction}</span>
                <button
                  type="button"
                  className="tbtn xs"
                  aria-label="Remove rule"
                  onClick={() => onRemove(r.id)}
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
          onSubmit={(e) => {
            e.preventDefault();
            const s = text.trim();
            if (!s) return;
            onAdd(s);
            setText('');
            setTab('rules');
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tell me if…"
            aria-label="New monitoring rule"
          />
          <button
            type="submit"
            className="tbtn tbtn-solid"
            aria-label="Add rule"
          >
            <Plus />
          </button>
        </form>
        <div className="chipset">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s}
              className="chip"
              onClick={() => setText(`Tell me if ${s.toLowerCase()}`)}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>
    </Cell>
  );
}

// Medication adherence -------------------------------------------------
export function AdherenceCard({ index }: { index: number }) {
  const flat = ADHERENCE.flat();
  const done = flat.filter((v) => v === 1).length,
    due = flat.filter((v) => v !== 2).length;
  const pct = Math.round((done / due) * 100);
  return (
    <Cell label="Medication" index={index}>
      <Card>
        <Row>
          <span className="card-title">This week</span>
          <span className="muted xs">
            {done} of {due} doses
          </span>
        </Row>
        <div className="big-num">
          {pct}
          <small>%</small>
        </div>
        <div className="adherence">
          {ADHERENCE.map((day, d) => (
            <div key={d} className="adh-day">
              {day.map((v, i) => (
                <i
                  key={i}
                  className={v === 1 ? 'ok' : v === 0 ? 'miss' : ''}
                  title={`${MEDS[i].name} · ${MEDS[i].time} ${MEDS[i].when}`}
                />
              ))}
              <span>{'MTWTFSS'[d]}</span>
            </div>
          ))}
        </div>
        <ul className="med-list">
          {MEDS.map((m) => (
            <li key={m.name}>
              <span className={`dot ${m.taken ? 'ok' : ''}`} />
              <span>
                <b>{m.name}</b>
                <small>
                  {m.time} {m.when} · with {m.with}
                </small>
              </span>
              <span className="muted xs">{m.taken ? 'Taken' : 'Upcoming'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Cell>
  );
}

// Device health (from /status.devices) --------------------------------
export function DeviceCard({
  status,
  online,
  now,
  onPause,
  index,
}: {
  status: Status;
  online: boolean;
  now: number;
  onPause: (p: boolean) => void;
  index: number;
}) {
  const d = status.devices[0];
  const rssi = d?.state.rssi ?? -100;
  const bars =
    rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : rssi > -85 ? 1 : 0;
  return (
    <Cell label="Necklace" index={index}>
      <Card>
        <Row>
          <span className="card-title">{d?.id || 'No device paired'}</span>
          <span className={`status-dot ${online ? 'ok' : ''}`}>
            {online ? (status.paused ? 'Paused' : 'Connected') : 'Offline'}
          </span>
        </Row>
        <div className="kv">
          <div>
            <small>Wi-Fi</small>
            <b className="signal" aria-label={`${rssi} dBm`}>
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className={i < bars ? 'on' : ''} />
              ))}
              <span>{rssi} dBm</span>
            </b>
          </div>
          <div>
            <small>Last heartbeat</small>
            <b>{d && now ? ago(now - d.last_seen) : '—'}</b>
          </div>
          <div>
            <small>Queued on card</small>
            <b>{d?.state.queued ?? 0} files</b>
          </div>
          <div>
            <small>Dropped</small>
            <b>{d?.state.dropped ?? 0}</b>
          </div>
        </div>
        <div className="track">
          <span
            className="track-fill soft"
            style={{
              width: `${d ? Math.min(100, 100 - (d.state.free_sd_bytes / 32e9) * 100) : 0}%`,
            }}
          />
        </div>
        <Row className="muted xs">
          <span>microSD</span>
          <span>{d ? `${bytes(d.state.free_sd_bytes)} free` : '—'}</span>
        </Row>
        {d?.state.error && (
          <p className="warn">
            <AlertTriangle />
            {d.state.error}
          </p>
        )}
        <Row className="mt18">
          <span className="muted xs">1 frame / second while recording</span>
          <Btn onClick={() => onPause(!status.paused)}>
            {status.paused ? <Play /> : <Pause />}
            {status.paused ? 'Resume capture' : 'Pause capture'}
          </Btn>
        </Row>
      </Card>
    </Cell>
  );
}

// Memory processing (from /status) -------------------------------------
export function ProcessingCard({
  status,
  onRetry,
  index,
}: {
  status: Status;
  onRetry: () => void;
  index: number;
}) {
  const total = Math.max(1, status.received);
  const seg = (n: number) => `${(n / total) * 100}%`;
  const used = status.storage_limit_bytes
    ? status.stored_bytes / status.storage_limit_bytes
    : 0;
  return (
    <Cell label="Memory" index={index}>
      <Card>
        <Row>
          <span className="card-title">Processing</span>
          <Cpu className="icon-muted" />
        </Row>
        <div className="big-num">
          {status.analyzed.toLocaleString()}
          <small>ready to recall</small>
        </div>
        <div className="segbar">
          <span className="sb-ok" style={{ width: seg(status.analyzed) }} />
          <span className="sb-pend" style={{ width: seg(status.pending) }} />
          <span className="sb-fail" style={{ width: seg(status.failed) }} />
        </div>
        <div className="legend">
          <span>
            <i className="sb-ok" />
            {status.analyzed} analyzed
          </span>
          <span>
            <i className="sb-pend" />
            {status.pending} processing
          </span>
          <span>
            <i className="sb-fail" />
            {status.failed} failed
          </span>
        </div>
        <div className="kv two">
          <div>
            <small>Model</small>
            <b>{status.model || '—'}</b>
          </div>
          <div>
            <small>Avg. per frame</small>
            <b>
              {status.average_analysis_ms
                ? `${(status.average_analysis_ms / 1000).toFixed(1)}s`
                : '—'}
            </b>
          </div>
        </div>
        <div className="track">
          <span
            className="track-fill soft"
            style={{ width: `${Math.min(100, used * 100)}%` }}
          />
        </div>
        <Row className="muted xs">
          <span>
            <HardDrive />
            {bytes(status.stored_bytes)} stored
          </span>
          <span>{bytes(status.storage_limit_bytes)} limit</span>
        </Row>
        {status.failed > 0 && (
          <Row className="mt18">
            <span className="muted xs">
              Originals are kept when analysis fails.
            </span>
            <Btn onClick={onRetry}>
              <RefreshCw />
              Retry {status.failed}
            </Btn>
          </Row>
        )}
      </Card>
    </Cell>
  );
}

// Latest capture with filmstrip ----------------------------------------
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
  onOpen: (r: Recording) => void;
  arriving?: string | null;
}) {
  const frames = records.filter((r) => r.kind === 'frame' && r.media_url);
  const [sel, setSel] = useState(0);
  const cur = frames[sel];
  return (
    <Cell label="Latest capture" link index={index}>
      <Card className="card-photo" data-card="moments">
        {cur ? (
          <>
            <button
              type="button"
              className={`photo ${cur.id === arriving ? 'is-arriving' : ''}`}
              data-frame={cur.id}
              onClick={() => onOpen(cur)}
            >
              <img src={cur.media_url} alt={cur.summary || 'Latest frame'} />
            </button>
            <div className="photo-foot">
              <div>
                <div className="card-title">
                  {sel === 0 ? 'Just now' : hm(cur.captured_at, zone)}
                </div>
                <div className="muted">
                  {cur.summary ||
                    (cur.status === 'pending'
                      ? 'Analyzing\u2026'
                      : 'Evidence saved')}
                </div>
              </div>
              <span className="muted xs">
                {cur.confidence
                  ? `${Math.round(cur.confidence * 100)}% sure`
                  : ''}
              </span>
            </div>
            <div className="strip">
              {frames.slice(0, 6).map((f, i) => (
                <button
                  type="button"
                  key={f.id}
                  className={i === sel ? 'is-sel' : ''}
                  onClick={() => setSel(i)}
                  aria-label={hm(f.captured_at, zone)}
                >
                  <img src={f.media_url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="board-empty tall">
            <Mic />
            <span>No frames yet. Connect the necklace.</span>
          </div>
        )}
      </Card>
    </Cell>
  );
}

// Questions Rose asked (from /answers) ----------------------------------
export function QuestionsCard({
  answers,
  zone,
  index,
}: {
  answers: Answer[];
  zone?: string;
  index: number;
}) {
  const [open, setOpen] = useState<string | null>(answers[0]?.id ?? null);
  return (
    <Cell label="Questions" index={index}>
      <Card>
        <Row>
          <span className="card-title">Rose asked</span>
          <span className="muted xs">{answers.length} today</span>
        </Row>
        <ul className="qa-list">
          {answers.slice(0, 4).map((a) => (
            <li key={a.id} className={open === a.id ? 'open' : ''}>
              <button
                type="button"
                onClick={() => setOpen(open === a.id ? null : a.id)}
              >
                <span className={`mode ${a.mode}`}>
                  {a.mode === 'wearable' ? <Mic /> : <Sparkles />}
                </span>
                <span className="q">
                  <b>{a.question}</b>
                  <small>
                    {hm(a.created_at, zone)} ·{' '}
                    {a.grounded ? 'from recordings' : 'no evidence found'}
                  </small>
                </span>
              </button>
              <p className="a">{a.answer.replace(/\[[0-9a-f-]{36}\]/g, '')}</p>
            </li>
          ))}
          {!answers.length && <li className="none">No questions yet.</li>}
        </ul>
      </Card>
    </Cell>
  );
}

// Sleep & steps trends ----------------------------------------------------
export function TrendsCard({ index }: { index: number }) {
  const [metric, setMetric] = useState<'steps' | 'sleep'>('sleep');
  const vals = metric === 'sleep' ? WEEK_SLEEP : WEEK_STEPS;
  const max = Math.max(...vals),
    avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return (
    <Cell label="Trends" index={index}>
      <Card>
        <Row>
          <span className="card-title">Past week</span>
          <div className="mini-seg">
            <button
              type="button"
              className={metric === 'sleep' ? 'is-active' : ''}
              onClick={() => setMetric('sleep')}
            >
              Sleep
            </button>
            <button
              type="button"
              className={metric === 'steps' ? 'is-active' : ''}
              onClick={() => setMetric('steps')}
            >
              Steps
            </button>
          </div>
        </Row>
        <div className="big-num">
          {avg.toFixed(1)}
          <small>{metric === 'sleep' ? 'h avg' : 'km avg'}</small>
        </div>
        <div className="bars">
          {vals.map((v, i) => (
            <div
              key={i}
              className={i === 5 ? 'is-sel' : ''}
              style={
                { '--h': `${(v / max) * 100}%`, '--i': i } as CSSProperties
              }
            >
              <i />
              <span>{'MTWTFSS'[i]}</span>
            </div>
          ))}
        </div>
        <p className="muted xs mt10">
          {metric === 'sleep'
            ? 'Friday was short. She napped after lunch.'
            : 'Most steps on Saturday: the garden and a walk with Priya.'}
        </p>
      </Card>
    </Cell>
  );
}

// Notes to Rose ---------------------------------------------------------
export function NotesCard({ index }: { index: number }) {
  const [notes, setNotes] = useState([
    {
      who: 'Priya',
      text: 'Mom, soup is in the fridge. Two minutes in the microwave.',
      when: '7:50 AM',
    },
  ]);
  const [text, setText] = useState('');
  return (
    <Cell label="Notes to Rose" index={index}>
      <Card>
        <div className="card-title mb14">Leave a note</div>
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            setNotes([
              {
                who: 'You',
                text: t,
                when: new Date().toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              },
              ...notes,
            ]);
            setText('');
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="It shows on her dashboard and can be read aloud."
            aria-label="Note to Rose"
          />
          <Row>
            <span className="muted xs">Read aloud when she asks</span>
            <Btn type="submit" disabled={!text.trim()}>
              <Send />
              Send
            </Btn>
          </Row>
        </form>
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={i}>
              <p className="serif sm">{n.text}</p>
              <span className="tag">
                {n.who} · {n.when}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Cell>
  );
}

// Care team ----------------------------------------------------------------
export function CareTeamCard({ index }: { index: number }) {
  return (
    <Cell label="Care team" index={index}>
      <Card>
        <div className="card-title mb14">Who helps</div>
        <ul className="stories">
          {PEOPLE.map((p) => (
            <li key={p.name}>
              <div className="story static">
                <Avatar src={p.img} />
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.role} · {p.note}
                  </small>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Cell>
  );
}

// Privacy & data ------------------------------------------------------------
export function DataCard({ status, index }: { status: Status; index: number }) {
  return (
    <Cell label="Privacy" index={index}>
      <Card>
        <Row>
          <span className="card-title">Her data</span>
          <span className="status-dot ok">
            {status.provider === 'ollama' ? 'Local AI' : status.provider}
          </span>
        </Row>
        <p className="muted mt10">
          Frames and audio stay on the home server. Nothing leaves the house
          unless you export it.
        </p>
        <div className="kv two mt18">
          <div>
            <small>Recordings</small>
            <b>{status.received.toLocaleString()}</b>
          </div>
          <div>
            <small>Free space</small>
            <b>{bytes(status.free_bytes)}</b>
          </div>
        </div>
        <Row className="mt18">
          <a className="btn" href="/api/export">
            <Download />
            Export metadata
          </a>
          <a className="btn ghost" href="/workspace">
            <ArrowUpRight />
            Workspace
          </a>
        </Row>
        <p className="muted xs mt10">
          <Trash2 />
          Deleting a recording removes its original, index entry and any answers
          built on it.
        </p>
      </Card>
    </Cell>
  );
}
