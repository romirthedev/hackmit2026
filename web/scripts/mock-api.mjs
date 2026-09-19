// Stand-in for the REWIND API so the phone client and dashboard can be run
// and demoed without the FastAPI server, Ollama, or a paired phone.
// Usage: pnpm demo:api   (then pnpm dev; Vite proxies /api to :8000)
// Frames posted from /phone show up on / within one poll. Nothing persists.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8000);
const started = Date.now() / 1000;
const media = new Map(); // id -> { type, buf }
const recordings = []; // newest first
const answers = [];
let rules = [
  {
    id: 'r1',
    instruction: 'Tell me if the stove is on for more than 20 minutes',
    enabled: 1,
  },
  {
    id: 'r2',
    instruction: 'Let Priya know if I have not moved by 10 am',
    enabled: 1,
  },
];
let alerts = [
  {
    id: 'a1',
    message: 'Front door was open for 12 minutes at 3:40 PM.',
    event_id: 'e1',
    created_at: started - 3600,
    seen: 0,
  },
];
let reminders = [
  {
    id: 'rem1',
    message: 'Dr. Lee, cardiology, at 2:00 PM. Leave in about 30 minutes.',
    seen: 0,
    starts_at: started + 1800,
  },
];
let paused = false;
const devices = [];

function json(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
  });
}
function status() {
  const now = Date.now() / 1000;
  return {
    received: recordings.length,
    analyzed: recordings.filter((r) => r.status === 'done').length,
    pending: recordings.filter((r) => r.status === 'pending').length,
    failed: 0,
    stored_bytes: [...media.values()].reduce((n, m) => n + m.buf.length, 0),
    free_bytes: 400e9,
    storage_limit_bytes: 500e9,
    last_capture: recordings[0]?.captured_at ?? null,
    average_analysis_ms: 1800,
    oldest_pending_at: null,
    devices: devices.filter((d) => now - d.last_seen < 120),
    provider: 'ollama',
    model: 'qwen3.5:35b-a3b',
    processing_host: 'asus-gx10',
    analysis_ready: true,
    verification_enabled: false,
    paused,
    observed_sequence_gaps: 0,
    embedding_failures: 0,
    timezone: 'America/New_York',
    visual_index: {
      enabled: true,
      indexed: recordings.length,
      pending: 0,
      failed: 0,
    },
  };
}
const SUMMARIES = [
  'Kitchen counter. Reading glasses next to the fruit bowl.',
  'Living room. Remote on the arm of the blue chair.',
  'Hallway table. Keys in the ceramic dish by the door.',
  'Bedroom nightstand. Pill organizer, Tuesday slot open.',
  'Front porch. Mail on the bench, sunny.',
];
function analyze(rec) {
  setTimeout(
    () => {
      rec.status = 'done';
      rec.summary =
        rec.kind === 'frame'
          ? SUMMARIES[recordings.indexOf(rec) % SUMMARIES.length]
          : 'Short conversation about lunch plans.';
      if (rec.kind === 'audio')
        rec.transcript = 'I think I will have the soup for lunch today.';
      rec.tags =
        rec.kind === 'frame' ? ['kitchen', 'glasses'] : ['conversation'];
      rec.confidence = 0.86;
    },
    2500 + Math.random() * 2000,
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/^\/api/, '');
  const m = req.method;
  if (m === 'OPTIONS') return json(res, {});
  if (p === '/status') return json(res, status());
  if (p === '/recordings' || p === '/events') {
    const limit = Number(url.searchParams.get('limit') || 100);
    const q = (url.searchParams.get('q') || '').toLowerCase();
    return json(
      res,
      recordings
        .filter((r) => !q || (r.summary || '').toLowerCase().includes(q))
        .slice(0, limit),
    );
  }
  if (p === '/answers') return json(res, answers);
  if (p === '/rules' && m === 'GET') return json(res, rules);
  if (p === '/rules' && m === 'POST') {
    const b = JSON.parse((await body(req)).toString() || '{}');
    rules = [
      { id: randomUUID(), instruction: b.instruction, enabled: 1 },
      ...rules,
    ];
    return json(res, rules[0]);
  }
  if (p.startsWith('/rules/') && m === 'DELETE') {
    rules = rules.filter((r) => r.id !== p.split('/')[2]);
    return json(res, { ok: true });
  }
  if (p === '/alerts') return json(res, alerts);
  if (/^\/alerts\/[^/]+\/seen$/.test(p)) {
    alerts = alerts.map((a) =>
      a.id === p.split('/')[2] ? { ...a, seen: 1 } : a,
    );
    return json(res, { ok: true });
  }
  if (p === '/context/reminders') return json(res, reminders);
  if (/^\/context\/reminders\/[^/]+\/seen$/.test(p)) {
    reminders = reminders.map((r) =>
      r.id === p.split('/')[3] ? { ...r, seen: 1 } : r,
    );
    return json(res, { ok: true });
  }
  if (p === '/context/graph')
    return json(res, {
      nodes: [
        { id: 'n1', label: 'Priya', kind: 'contact', source: 'notch' },
        {
          id: 'n2',
          label: 'Dr. Lee 2:00 PM',
          kind: 'calendar',
          source: 'notch',
        },
        { id: 'n3', label: 'Lunch with Dana', kind: 'note', source: 'notch' },
        { id: 'n4', label: 'Pharmacy refill', kind: 'email', source: 'notch' },
      ],
      edges: [{ source: 'n1', target: 'n2', relation: 'attends' }],
      status: {
        configured: true,
        enabled: true,
        last_sync: Date.now() / 1000 - 40,
        sources: { notes: 'ok', calendar: 'ok', contacts: 'ok', mail: 'ok' },
        counts: { notes: 12, calendar: 3, contacts: 8, mail: 5 },
        error: '',
      },
    });
  if (p === '/context/connect' || p === '/context/disconnect')
    return json(res, { ok: true });
  if (p === '/computer/state')
    return json(res, {
      connected: false,
      accessibility_granted: false,
      screen_recording_granted: false,
      request_id: '',
      state: 'idle',
      transcript: '',
      response: '',
      error: '',
      success: false,
      steps: [],
      permission: null,
      recent: [],
    });
  if (p.startsWith('/computer/')) return json(res, { status: 'queued' });
  if (p === '/capture/pause') {
    const b = JSON.parse((await body(req)).toString() || '{}');
    paused = !!b.paused;
    return json(res, { paused });
  }
  if (p === '/retry' || p === '/logout') return json(res, { ok: true });
  if (p === '/pairing')
    return json(res, {
      code: '482913',
      ticket: 'demo',
      expires_at: Date.now() / 1000 + 600,
      public_url: 'http://127.0.0.1:3100/phone',
    });
  if (p === '/scene')
    return json(res, { available: false, points: [], cameras: [], frames: [] });
  if (p === '/ask' && m === 'POST') {
    const b = JSON.parse((await body(req)).toString() || '{}');
    await new Promise((r) => setTimeout(r, 900));
    const evidence = recordings.filter((r) => r.status === 'done').slice(0, 2);
    const a = {
      id: randomUUID(),
      question: b.question,
      answer: evidence.length
        ? `${evidence[0].summary} I saw this at ${new Date(evidence[0].captured_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : 'I have not recorded anything yet today. Tap Record or Scan and I will remember it.',
      evidence,
      created_at: Date.now() / 1000,
      grounded: evidence.length > 0,
      mode: 'typed',
      verification: null,
    };
    answers.unshift(a);
    return json(res, a);
  }
  if (/^\/ingest\/(frame|audio)$/.test(p) && m === 'POST') {
    const kind = p.split('/')[2];
    const buf = await body(req);
    const id = randomUUID();
    media.set(id, {
      type: req.headers['content-type'] || 'application/octet-stream',
      buf,
    });
    const at = Number(req.headers['x-captured-at']) || Date.now() / 1000;
    const rec = {
      id,
      kind,
      captured_at: at,
      received_at: Date.now() / 1000,
      clock_quality: 'device',
      status: 'pending',
      summary: '',
      media_url: '/api/media/' + id,
      device: req.headers['x-boot-id'] ? 'phone' : 'import',
      intent: req.headers['x-intent'] || 'memory',
    };
    recordings.unshift(rec);
    const boot = String(req.headers['x-boot-id'] || 'phone');
    const dev = devices.find((d) => d.id === boot);
    if (dev) dev.last_seen = Date.now() / 1000;
    else
      devices.push({
        id: boot,
        last_seen: Date.now() / 1000,
        state: {
          queued: 0,
          dropped: 0,
          rssi: -52,
          error: '',
          free_sd_bytes: 30e9,
        },
      });
    analyze(rec);
    return json(res, { id, status: 'queued' });
  }
  if (p.startsWith('/media/')) {
    const item = media.get(p.split('/')[2]);
    if (!item) return json(res, { detail: 'not found' }, 404);
    res.writeHead(200, {
      'Content-Type': item.type,
      'Cache-Control': 'no-store',
    });
    return res.end(item.buf);
  }
  json(res, { detail: 'Not found: ' + p }, 404);
});
server.listen(PORT, '127.0.0.1', () =>
  console.log('mock REWIND api on http://127.0.0.1:' + PORT),
);
