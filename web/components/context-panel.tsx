'use client';
import { useEffect, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  Link2,
  LoaderCircle,
  Mail,
  Users,
} from 'lucide-react';
import { api, type Recording } from '@/lib/api';
import './context-panel.css';
import { FrameImage } from '@/components/catalog';

type ContextStatus = {
  configured: boolean;
  enabled: boolean;
  last_sync: number | null;
  sources: Record<string, string>;
  counts: Record<string, number>;
  error: string;
};
type Node = {
  id: string;
  label: string;
  kind: string;
  source: string;
  document_id?: string;
};
type Graph = {
  nodes: Node[];
  edges: { source: string; target: string; relation: string }[];
  status: ContextStatus;
};
const COLORS: Record<string, string> = {
  moment: '#bcb2ff',
  note: '#baa8ef',
  email: '#ffcb9e',
  calendar: '#92dac3',
  contact: '#f0b9da',
};
export function ContextPanel() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Recording | null>(null);
  const [scopes, setScopes] = useState({
    notes: true,
    calendar: true,
    contacts: true,
    mail: true,
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Graph>('/context/graph')
        .then((result) => {
          if (alive) setGraph(result);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function connect() {
    setBusy(true);
    setError('');
    try {
      await api('/context/connect', {
        method: 'POST',
        body: JSON.stringify(scopes),
      });
      setGraph(await api<Graph>('/context/graph'));
    } catch (problem) {
      setError(String(problem).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  }
  const nodes = (graph?.nodes || []).slice(0, 60);
  const positions = new Map(
    nodes.map((node, index) => {
      const angle =
        (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = node.kind === 'contact' ? 80 : 130 + (index % 3) * 24;
      return [
        node.id,
        {
          x: 250 + Math.cos(angle) * radius,
          y: 215 + Math.sin(angle) * radius,
        },
      ];
    }),
  );
  return (
    <section className="context-panel">
      <div className="context-heading">
        <span className="context-symbol">
          <Link2 size={22} />
        </span>
        <div>
          <span className="context-eyebrow">POWERED BY YOUR NOTCH MEMORY</span>
          <h2>Life, connected.</h2>
        </div>
      </div>
      <p className="context-description">
        Your moments make more sense with the people, plans, and conversations
        around them.
      </p>
      <div className="context-sources">
        {(
          [
            ['notes', BookOpen, 'Memory notes', 'note'],
            ['calendar', CalendarDays, 'Appointments', 'calendar'],
            ['contacts', Users, 'People & family', 'contact'],
            ['mail', Mail, 'Email', 'email'],
          ] as const
        ).map(([key, Icon, label, kind]) => (
          <label key={key} className="context-source">
            <Icon size={21} />
            <span>
              <strong>{label}</strong>
              <small>
                {graph?.status.sources[key] === 'connected'
                  ? `${graph.status.counts[kind] || 0} connected`
                  : (
                      graph?.status.sources[key] || 'Ready to connect'
                    ).replaceAll('_', ' ')}
              </small>
            </span>
            <input
              type="checkbox"
              checked={scopes[key]}
              onChange={(event) =>
                setScopes({ ...scopes, [key]: event.target.checked })
              }
            />
          </label>
        ))}
      </div>
      <button
        className="context-connect"
        disabled={busy || !graph?.status.configured}
        onClick={() => void connect()}
      >
        {busy ? (
          <LoaderCircle size={18} className="spin" />
        ) : graph?.status.enabled ? (
          <Check size={18} />
        ) : (
          <Link2 size={18} />
        )}
        {busy
          ? 'Connecting your sources…'
          : graph?.status.enabled
            ? 'Update connections'
            : 'Connect Notch'}
      </button>
      {!graph?.status.configured && (
        <p className="context-help">
          Notch hasn’t been connected to this workspace yet. Complete the Mac
          bridge setup, then connect your sources here.
        </p>
      )}
      <p className="context-help">
        Calendar, Contacts, and Mail may ask for access on the Mac. Sources are
        read only. Connections come from your real data.
      </p>
      {(error || graph?.status.error) && (
        <p className="context-error" role="alert">
          {error || graph?.status.error}
        </p>
      )}
      <div className="context-graph-heading">
        <h3>Your memory graph</h3>
        <span>{graph?.nodes.length || 0} connections & moments</span>
      </div>
      {nodes.length ? (
        <div className="context-graph">
          <svg
            viewBox="0 0 500 430"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- This is an inline SVG visualization, not a raster image.
            role="img"
            aria-label="Connected memory graph"
          >
            {graph?.edges.map((edge, i) => {
              const a = positions.get(edge.source),
                b = positions.get(edge.target);
              return a && b ? (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="currentColor"
                  strokeDasharray={
                    edge.relation === 'text_mentions_unverified'
                      ? '3 4'
                      : undefined
                  }
                />
              ) : null;
            })}
            {nodes.map((node) => {
              const point = positions.get(node.id)!;
              const open = () => {
                void api<Recording>(
                  node.source === 'notch'
                    ? '/context/documents/' + (node.document_id || node.id)
                    : '/events/' + node.id,
                )
                  .then(setSelected)
                  .catch((problem) => setError(String(problem)));
              };
              return (
                <g
                  key={node.id}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG nodes have no native button element.
                  role="button"
                  tabIndex={0}
                  aria-label={node.label}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') open();
                  }}
                >
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={node.kind === 'contact' ? 9 : 6}
                    fill={COLORS[node.kind] || '#c5c0ff'}
                  />
                  <text x={point.x} y={point.y + 21} textAnchor="middle">
                    {node.label.length > 19
                      ? node.label.slice(0, 17) + '…'
                      : node.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="context-legend">
            {Object.entries(COLORS).map(([kind, color]) => (
              <span key={kind}>
                <i style={{ background: color }} />
                {kind === 'moment' ? 'Recorded moments' : kind}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="context-empty">
          <Link2 size={36} />
          <h3>Your graph starts with you.</h3>
          <p>Connect Notch and record a moment to begin.</p>
        </div>
      )}
      {selected && (
        <article className="context-document">
          <button onClick={() => setSelected(null)} aria-label="Close source">
            ×
          </button>
          <small>{selected.context_kind || 'Recorded moment'}</small>
          <h3>{selected.title || selected.summary}</h3>
          <p>{selected.text || selected.transcript || selected.summary}</p>
          {selected.kind === 'frame' && (
            <FrameImage
              src={selected.media_url}
              alt={selected.summary || 'Original evidence'}
            />
          )}
        </article>
      )}
      <p className="context-help">
        Solid lines follow linked notes or matching contact emails. Dotted lines
        are text mentions, not verified identification of someone in a
        recording.
      </p>
      {graph?.status.last_sync && (
        <p className="context-help">
          Last synced{' '}
          {new Date(graph.status.last_sync * 1000).toLocaleTimeString()} ·
          upcoming appointments are checked every minute.
        </p>
      )}
      {graph?.status.enabled && (
        <button
          className="context-disconnect"
          onClick={() => {
            void api('/context/disconnect', { method: 'POST' }).then(
              async () => {
                setSelected(null);
                setGraph(await api<Graph>('/context/graph'));
              },
            );
          }}
        >
          Disconnect and remove synced context
        </button>
      )}
    </section>
  );
}
