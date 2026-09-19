export type Observation = {
  label: string;
  description: string;
  location: string;
  bbox: number[];
  confidence: number;
};
export type Recording = {
  id: string;
  kind: 'frame' | 'audio';
  captured_at: number;
  received_at?: number;
  clock_quality: string;
  status?: string;
  summary?: string;
  transcript?: string;
  objects?: Observation[];
  tags?: string[];
  confidence?: number;
  segments?: { start: number; end: number; text: string }[];
  media_url: string;
  error?: string;
  device?: string;
  provenance?: {
    source_sha256: string;
    source_offset: number;
    frame_index: number | null;
    clip_index: number;
    sample_fps: number;
    clock: 'synthetic' | 'recording_start';
  };
};
export type Answer = {
  id: string;
  question: string;
  answer: string;
  evidence: Recording[];
  created_at: number;
  grounded: boolean;
  mode: string;
};
export type Device = {
  id: string;
  last_seen: number;
  state: {
    queued: number;
    dropped: number;
    rssi: number;
    error: string;
    free_sd_bytes: number;
  };
};
export type Status = {
  received: number;
  analyzed: number;
  pending: number;
  failed: number;
  stored_bytes: number;
  free_bytes: number;
  storage_limit_bytes: number;
  last_capture: number | null;
  average_analysis_ms: number | null;
  oldest_pending_at: number | null;
  devices: Device[];
  provider: string;
  model: string;
  paused: boolean;
  observed_sequence_gaps: number;
  embedding_failures: number;
  timezone: string;
  visual_index?: { enabled: boolean; indexed: number; pending: number; failed: number };
};
export type Rule = { id: string; instruction: string; enabled: number };
export type Alert = {
  id: string;
  message: string;
  event_id: string;
  created_at: number;
  seen: number;
};
export type Scene = {
  available: boolean;
  points: number[][];
  cameras: number[][];
  frames: { id: string; captured_at: number }[];
  markers?: {
    id: string;
    label: string;
    position: number[];
    captured_at: number;
  }[];
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof Blob) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const r = await fetch('/api' + path, {
    ...init,
    headers,
  });
  if (!r.ok) {
    let message = `Request failed (${r.status})`;
    try {
      message = ((await r.json()) as { detail?: string }).detail || message;
    } catch {}
    throw new Error(message);
  }
  return r.json();
}
export function clock(time: number, zone?: string) {
  return new Date(time * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: zone,
  });
}
export function recordingClock(recording: Recording) {
  if (recording.clock_quality === 'synthetic') return 'import timeline · real capture time unknown';
  if (recording.clock_quality === 'imported') return 'imported capture time';
  if (recording.clock_quality === 'received_only') return 'capture time unknown · receive time';
  return 'device timestamp';
}
export function bytes(n: number) {
  return n < 1e6
    ? `${(n / 1e3).toFixed(0)} KB`
    : n < 1e9
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${(n / 1e9).toFixed(1)} GB`;
}
