'use client';
/* oxlint-disable next/no-img-element -- frames come from the authenticated local media route */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  CarFront,
  Check,
  Clock,
  Footprints,
  Image as ImageIcon,
  MessageCircle,
  Pause,
  Phone,
  Pill,
  Play,
  Search,
  Siren,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { Recording, Status } from '@/lib/api';
import { Avatar, Btn, Card, Cell, Row, hm, pad } from './primitives';
import { DAYS, MEDS, PEOPLE, PINS, WEEK_STEPS } from './demo-data';

const FILL: Record<string, string> = {
  blue: 'c-blue',
  pink: 'c-pink',
  amber: 'c-amber',
};

// Your clip (music-card pattern) ------------------------------------
export function ClipCard({
  status,
  online,
  onPause,
  index,
}: {
  status: Status;
  online: boolean;
  onPause: (p: boolean) => void;
  index: number;
}) {
  const [rec, setRec] = useState(6 * 3600 + 12 * 60 + 4);
  const recording = online && !status.paused;
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRec((r) => r + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  const h = Math.floor(rec / 3600),
    m = Math.floor((rec % 3600) / 60),
    s = rec % 60;
  const dev = status.devices[0];
  const sub = !online
    ? 'Not connected'
    : status.paused
      ? 'Paused · tap to resume'
      : 'Recording · cardigan';
  return (
    <Cell label="Your clip" index={index}>
      <Card>
        <div className="media-row">
          <div className="device">
            <span className="device-lens" />
            <span
              className={`device-led ${!online ? 'off' : status.paused ? 'amber' : ''}`}
            />
          </div>
          <div className="media-meta">
            <div className="card-title">Rewind clip</div>
            <div className="muted">{sub}</div>
            <div className="transport">
              <button
                type="button"
                className="tbtn"
                aria-label="Back 30 seconds"
                onClick={() => setRec((r) => Math.max(0, r - 30))}
              >
                <SkipBack />
              </button>
              <button
                type="button"
                className="tbtn tbtn-solid"
                aria-label={status.paused ? 'Resume' : 'Pause'}
                onClick={() => onPause(!status.paused)}
              >
                {status.paused ? <Play /> : <Pause />}
              </button>
              <button
                type="button"
                className="tbtn"
                aria-label="Forward 30 seconds"
                onClick={() => setRec((r) => r + 30)}
              >
                <SkipForward />
              </button>
            </div>
          </div>
        </div>
        <div className="track">
          <span
            className="track-fill"
            style={{ width: `${(rec / (8 * 3600)) * 100}%` }}
          />
        </div>
        <Row className="muted xs tabular">
          <span>
            {h}:{pad(m)}:{pad(s)}
          </span>
          <span>
            {dev
              ? `${Math.round((dev.state.free_sd_bytes / 32e9) * 100)}% card free`
              : '78% battery'}
          </span>
        </Row>
      </Card>
    </Cell>
  );
}

// On the way (flight-card pattern) ----------------------------------
export function OnTheWayCard({ index }: { index: number }) {
  const [p, setP] = useState(62);
  useEffect(() => {
    const t = setInterval(() => setP((v) => Math.min(v + 0.15, 96)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Cell label="On the way" index={index}>
      <Card>
        <div className="card-title">Priya</div>
        <div className="route">
          <div>
            <div className="code">Home</div>
            <div className="muted xs">Somerville</div>
          </div>
          <div className="ta-r">
            <div className="code">Rose</div>
            <div className="muted xs">Cambridge</div>
          </div>
        </div>
        <div className="route-bar">
          <span className="route-fill" style={{ width: `${p}%` }} />
          <CarFront className="route-icon" style={{ left: `${p}%` }} />
        </div>
        <div className="route">
          <div>
            <div className="time">1:35</div>
            <div className="muted xs">Left · PM</div>
          </div>
          <div className="ta-r">
            <div className="time">2:00</div>
            <div className="muted xs">Arrives · PM</div>
          </div>
        </div>
      </Card>
    </Cell>
  );
}

// Where is it (map-card pattern) ------------------------------------
export function WhereCard({ index }: { index: number }) {
  const [active, setActive] = useState(0);
  const [fade, setFade] = useState(false);
  const pick = (i: number) => {
    if (i === active) return;
    setFade(true);
    setTimeout(() => {
      setActive(i);
      setFade(false);
    }, 200);
  };
  return (
    <Cell label="Where is it" index={index}>
      <Card className="card-map">
        <div className="plan">
          <svg
            viewBox="0 0 330 250"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="fadeWhite" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0.22" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.72" stopColor="#fff" stopOpacity="1" />
              </linearGradient>
            </defs>
            <rect width="330" height="250" fill="#f3f5f7" />
            <rect x="20" y="16" width="150" height="104" fill="#eaf2e4" />
            <rect x="170" y="16" width="140" height="74" fill="#fbf1e3" />
            <rect x="170" y="90" width="66" height="124" fill="#f4f4f6" />
            <rect x="236" y="90" width="74" height="124" fill="#eceffb" />
            <rect x="20" y="120" width="150" height="94" fill="#e6f1f6" />
            <g fill="#fff" stroke="#c9d3da" strokeWidth="1.2">
              <rect x="36" y="34" width="80" height="26" rx="8" />
              <rect x="36" y="64" width="24" height="26" rx="6" />
              <circle cx="130" cy="78" r="17" />
              <rect x="186" y="26" width="112" height="18" rx="3" />
              <rect x="276" y="44" width="22" height="34" rx="3" />
              <rect x="250" y="112" width="48" height="70" rx="5" />
              <rect x="254" y="118" width="18" height="12" rx="3" />
              <rect x="276" y="118" width="18" height="12" rx="3" />
              <rect x="36" y="138" width="60" height="30" rx="12" />
              <circle cx="140" cy="150" r="10" />
            </g>
            <g
              fill="none"
              stroke="#9aa5ae"
              strokeWidth="3"
              strokeLinecap="square"
            >
              <rect x="20" y="16" width="290" height="198" />
              <path d="M170 16v56M170 100v114" />
              <path d="M170 90h30M228 90h82" />
              <path d="M236 90v124" />
              <path d="M20 120h60M108 120h62" />
            </g>
            <g
              fill="#8b96a0"
              fontFamily="Inter, sans-serif"
              fontSize="7.5"
              fontWeight="500"
              letterSpacing="0.6"
            >
              <text x="30" y="110">
                LIVING
              </text>
              <text x="178" y="82">
                KITCHEN
              </text>
              <text x="178" y="206">
                HALL
              </text>
              <text x="244" y="206">
                BEDROOM
              </text>
              <text x="30" y="206">
                BATH
              </text>
            </g>
            <rect
              width="330"
              height="250"
              fill="url(#fadeWhite)"
              pointerEvents="none"
            />
            {PINS.map((pin, i) => (
              <g
                key={pin.name}
                className={`pin ${i === active ? 'is-active' : ''}`}
                transform={`translate(${pin.x} ${pin.y})`}
                tabIndex={0}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- buttons cannot live inside an SVG floor plan
                role="button"
                aria-label={pin.name}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick(i);
                  }
                }}
              >
                <circle r="16" className="pin-halo" />
                <circle r="14" fill="transparent" />
                <circle r="5.5" className="pin-core" />
                <g
                  className="pin-label"
                  transform={`translate(${pin.left ? -(pin.w + 14) : 12} -10)`}
                >
                  <rect width={pin.w} height="20" rx="10" />
                  <text x={pin.w / 2} y="13.5">
                    {pin.label}
                  </text>
                </g>
              </g>
            ))}
          </svg>
        </div>
        <div className={`map-text ${fade ? 'fade' : ''}`}>
          <div className="card-title">{PINS[active].name}</div>
          <div className="muted">{PINS[active].where}</div>
        </div>
      </Card>
    </Cell>
  );
}

// Today ----------------------------------------------------------------
export function TodayCard({ index }: { index: number }) {
  const [sel, setSel] = useState(5);
  const [fade, setFade] = useState(false);
  const pick = (i: number) => {
    setFade(true);
    setTimeout(() => {
      setSel(i);
      setFade(false);
    }, 220);
  };
  const [name, date, list] = DAYS[sel];
  return (
    <Cell label="Today" index={index}>
      <Card>
        <Row>
          <span className="card-title">{name}</span>
          <span className="muted xs">{date}</span>
        </Row>
        <div className="week">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <button
              type="button"
              key={i}
              className={`${i === 5 ? 'today' : ''} ${i === sel ? 'is-sel' : ''}`}
              onClick={() => pick(i)}
            >
              <span>{d}</span>
              <b>{14 + i}</b>
            </button>
          ))}
        </div>
        <ul className={`events ${fade ? 'fade' : ''}`}>
          {list.length ? (
            list.map(([t, c, title, sub]) => (
              <li key={t + title}>
                <span className="ev-t">{t}</span>
                <span className={`ev-bar ${FILL[c]}`} />
                <span>
                  <b>{title}</b>
                  <small>{sub}</small>
                </span>
              </li>
            ))
          ) : (
            <li className="none">Nothing planned. A quiet day.</li>
          )}
        </ul>
      </Card>
    </Cell>
  );
}

// People ----------------------------------------------------------------
export function PeopleCard({
  index,
  title = "Who's around",
  people = PEOPLE.slice(0, 3),
}: {
  index: number;
  title?: string;
  people?: typeof PEOPLE;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Cell label="People" index={index}>
      <Card>
        <div className="card-title mb14">{title}</div>
        <ul className="stories">
          {people.map((p) => (
            <li key={p.name} className={open === p.name ? 'open' : ''}>
              <button
                type="button"
                className="story"
                onClick={() => setOpen(open === p.name ? null : p.name)}
              >
                <Avatar src={p.img} />
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.role} · {p.note}
                  </small>
                </span>
              </button>
              <div className="story-more">
                <Btn className="sm">
                  <Phone />
                  Call
                </Btn>
                <Btn className="sm">
                  <MessageCircle />
                  Message
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Cell>
  );
}

// Memory log (inbox pattern), driven by real recordings ----------------
export function MemoryLogCard({
  records,
  zone,
  index,
}: {
  records: Recording[];
  zone?: string;
  index: number;
}) {
  const [q, setQ] = useState('');
  const items = records.filter((r) => r.summary || r.transcript).slice(0, 5);
  const shown = items.filter(
    (r) =>
      !q ||
      (r.summary || r.transcript || '')
        .toLowerCase()
        .includes(q.toLowerCase()) ||
      (r.tags || []).join(' ').toLowerCase().includes(q.toLowerCase()),
  );
  const title = (r: Recording) =>
    r.kind === 'audio'
      ? 'Something said'
      : r.tags?.[0]
        ? r.tags[0][0].toUpperCase() + r.tags[0].slice(1)
        : 'Moment';
  return (
    <Cell label="Memory log" index={index}>
      <Card>
        <Row>
          <span className="card-title">
            Today <span className="cnt">{records.length} moments</span>
          </span>
          <label className={`search ${q ? 'open' : ''}`}>
            <Search />
            <span className="search-text">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search moments"
            />
          </label>
        </Row>
        <ul className="inbox">
          {shown.map((r, i) => (
            <li key={r.id} className={i < 2 && !q ? 'unread' : ''}>
              <div className="inbox-head">
                <b>{title(r)}</b>
                <span>{hm(r.captured_at, zone)}</span>
              </div>
              <p>{r.summary || r.transcript}</p>
              {r.kind === 'frame' && r.media_url && i === 1 && (
                <div className="stack">
                  {records
                    .filter((x) => x.kind === 'frame' && x.media_url)
                    .slice(0, 3)
                    .map((x) => (
                      <img key={x.id} src={x.media_url} alt="" />
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {!shown.length && (
          <p className="muted xs empty">Nothing matches yet.</p>
        )}
      </Card>
    </Cell>
  );
}

// Note -----------------------------------------------------------------
export function NoteCard({
  index,
  from = 'From Priya',
  text = 'Mom, soup is in the fridge. Two minutes in the microwave.',
  tag = 'Left this morning · 7:50',
}: {
  index: number;
  from?: string;
  text?: string;
  tag?: string;
}) {
  return (
    <Cell label="Note" index={index}>
      <Card>
        <div className="card-title">{from}</div>
        <p className="serif">{text}</p>
        <span className="tag">{tag}</span>
      </Card>
    </Cell>
  );
}

// Moments (mood-board pattern) -----------------------------------------
export function MomentsCard({
  records,
  zone,
  index,
  onOpen,
}: {
  records: Recording[];
  zone?: string;
  index: number;
  onOpen: (r: Recording) => void;
}) {
  const frames = records
    .filter((r) => r.kind === 'frame' && r.media_url)
    .slice(0, 4);
  return (
    <Cell label="Moments" link index={index}>
      <Card>
        <div className="board">
          {frames.map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => onOpen(r)}
              aria-label={r.summary || 'Open moment'}
            >
              <img src={r.media_url} alt="" loading="lazy" />
            </button>
          ))}
          {frames.length === 0 && (
            <div className="board-empty">
              <ImageIcon />
              <span>No frames yet</span>
            </div>
          )}
        </div>
        <Row>
          <span>
            <div className="card-title">Moments</div>
            <div className="muted">Captured by your clip</div>
          </span>
          <span className="muted xs">
            {frames.length} {frames.length === 1 ? 'frame' : 'frames'}
            {frames[0] ? ` · ${hm(frames[0].captured_at, zone)}` : ''}
          </span>
        </Row>
      </Card>
    </Cell>
  );
}

// Medications (up-next pattern) ----------------------------------------
export function MedsCard({ index }: { index: number }) {
  const [taken, setTaken] = useState(false);
  const [left, setLeft] = useState('');
  useEffect(() => {
    const f = () => {
      const now = new Date();
      const d = new Date(now);
      d.setHours(12, 30, 0, 0);
      if (d < now) d.setDate(d.getDate() + 1);
      const m = Math.round((d.getTime() - now.getTime()) / 60000);
      setLeft(m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)}h ${m % 60}m`);
    };
    f();
    const t = setInterval(f, 15000);
    return () => clearInterval(t);
  }, []);
  const next = MEDS[1];
  return (
    <Cell label="Medications" index={index}>
      <Card>
        <Row>
          <span className="card-title">Next dose</span>
          <Clock className="icon-muted" />
        </Row>
        <div className="big-time">
          {next.time}
          <span>{next.when}</span>
        </div>
        <div className="card-title">{next.name}</div>
        <div className="muted">
          1 tablet · with {next.with} · {left}
        </div>
        <Row className="mt18">
          <div className="stack round">
            {['c1', 'c2', 'c3'].map((c) => (
              <span key={c} className={`pill-chip ${c}`}>
                <Pill />
              </span>
            ))}
          </div>
          <Btn onClick={() => setTaken(true)} disabled={taken}>
            <Check />
            {taken ? 'Taken · 12:30 PM' : 'Mark as taken'}
          </Btn>
        </Row>
      </Card>
    </Cell>
  );
}

// Weather ----------------------------------------------------------------
const WX = [
  ['Now', 58, 'Clear'],
  ['Sat', 63, 'Sunny'],
  ['Sun', 65, 'Sunny'],
  ['Mon', 72, 'Warm'],
  ['Tue', 70, 'Cloudy'],
] as const;
export function WeatherCard({ index }: { index: number }) {
  const [sel, setSel] = useState(0);
  return (
    <Cell label="Weather" index={index}>
      <Card className="card-sky">
        <div className="card-title">Cambridge</div>
        <div className="wx">
          <div className="wx-temp">
            {WX[sel][1]}°<small>F</small>
          </div>
          <div className="wx-cond">{WX[sel][2]}</div>
        </div>
        <div className="wx-days">
          {WX.map((d, i) => (
            <button
              type="button"
              key={d[0]}
              className={i === sel ? 'is-sel' : ''}
              onClick={() => setSel(i)}
            >
              <span>{d[0]}</span>
              <b>{d[1]}°</b>
            </button>
          ))}
        </div>
      </Card>
    </Cell>
  );
}

// Activity ---------------------------------------------------------------
export function ActivityCard({
  index,
  values = WEEK_STEPS,
  unit = 'km',
  label = 'Activity',
  icon = <Footprints className="icon-muted" />,
}: {
  index: number;
  values?: number[];
  unit?: string;
  label?: string;
  icon?: React.ReactNode;
}) {
  const [sel, setSel] = useState(5);
  const [shown, setShown] = useState(0);
  const max = Math.max(...values);
  useEffect(() => {
    const from = shown,
      to = values[sel],
      t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min((now - t0) / 700, 1),
        e = 1 - Math.pow(1 - t, 3);
      setShown(from + (to - from) * e);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- animate from the last shown value only when the selection changes
  }, [sel]);
  return (
    <Cell label={label} index={index}>
      <Card>
        <Row>
          <span className="card-title">{label}</span>
          {icon}
        </Row>
        <div className="big-num">
          {shown.toFixed(1)}
          <small>{unit}</small>
        </div>
        <div className="bars">
          {values.map((v, i) => (
            <button
              type="button"
              key={i}
              className={i === sel ? 'is-sel' : ''}
              style={
                { '--h': `${(v / max) * 100}%`, '--i': i } as CSSProperties
              }
              onClick={() => setSel(i)}
            >
              <i />
              <span>{'MTWTFSS'[i]}</span>
            </button>
          ))}
        </div>
      </Card>
    </Cell>
  );
}

// Quick help -------------------------------------------------------------
export function HelpCard({ index }: { index: number }) {
  const [calling, setCalling] = useState<string | null>(null);
  const rows = [
    { key: 'Priya', img: PEOPLE[0].img, sub: 'Daughter' },
    { key: 'Dr. Lee', img: PEOPLE[3].img, sub: 'Cambridge Clinic' },
  ];
  return (
    <Cell label="Quick help" index={index}>
      <Card>
        <div className="card-title mb14">Call someone</div>
        <div className="help">
          {rows.map((r) => (
            <button
              type="button"
              key={r.key}
              className={`help-btn ${calling === r.key ? 'calling' : ''}`}
              onClick={() => setCalling(calling === r.key ? null : r.key)}
            >
              <Avatar src={r.img} size={36} className="sm" />
              <span>
                <b>{r.key}</b>
                <small>
                  {calling === r.key ? 'Calling\u2026 tap to cancel' : r.sub}
                </small>
              </span>
              <Phone />
            </button>
          ))}
          <button
            type="button"
            className={`help-btn alert ${calling === '911' ? 'calling' : ''}`}
            onClick={() => setCalling(calling === '911' ? null : '911')}
          >
            <span className="thumb sm alert-ico">
              <Siren />
            </span>
            <span>
              <b>Emergency</b>
              <small>
                {calling === '911' ? 'Calling\u2026 tap to cancel' : 'Call 911'}
              </small>
            </span>
            <Phone />
          </button>
        </div>
      </Card>
    </Cell>
  );
}
