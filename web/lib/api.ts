export type Observation = {
  label: string;
  description: string;
  location: string;
  bbox: number[];
  confidence: number;
};
export type Recording = {
  id: string;
  kind: 'frame' | 'audio' | 'context';
  source?: 'notch';
  demo_protected?: boolean;
  context_kind?: string;
  title?: string;
  text?: string;
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
  original_recording?: {
    recording_id: string;
    status: string;
    complete: boolean;
    end_reason: string | null;
    original_url: string | null;
    continuous_video_inspected: boolean;
  };
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
  verification?: {
    status: string;
    receipt: {
      claims_reviewed?: boolean;
      cached?: boolean;
      method?: string;
      reviewer?: string;
      answer_complete?: boolean;
      reviews?: {
        model: string;
        seconds: number;
        result: { reason: string };
      }[];
    };
  } | null;
};
export type ConversationTurn = {
  id: string;
  transcript: string;
  response: string;
  response_revision: number;
  status: string;
  kind: string | null;
  answer_id?: string | null;
  command_id?: string | null;
  created_at: number;
};
export type ConversationState = {
  status: string;
  turns: ConversationTurn[];
  error?: string | null;
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
  demo?: {
    enabled: boolean;
    ready: boolean;
    entry_count: number;
    protected_media_count: number;
    protected_recording_count: number;
    error: string;
  };
  phone?: {
    last_seen: number;
    battery: number | null;
    charging: boolean | null;
  } | null;
  browser_open_access?: boolean;
  history_cleared_before?: number;
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
  processing_host?: string;
  analysis_ready?: boolean;
  verification_enabled?: boolean;
  paused: boolean;
  observed_sequence_gaps: number;
  embedding_failures: number;
  timezone: string;
  visual_index?: {
    enabled: boolean;
    indexed: number;
    pending: number;
    failed: number;
  };
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
// A document read from one Scan photo: a postcard, letter, bill or appointment card.
export type ScanDocument = {
  id: string;
  media_id: string | null;
  image_url: string | null;
  created_at: number;
  seq: number;
  kind: 'postcard' | 'letter' | 'bill' | 'appointment' | 'other';
  source: 'model' | 'template' | 'model+template';
  due_at: number | null;
  seen: number;
  title: string;
  sender: string;
  recipient: string;
  date: string;
  due_date: string;
  amount: string;
  place?: string;
  message: string;
};
// Food seen at the mouth in one photo and gone from the next ones.
export type Meal = {
  id: string;
  food: string;
  status: 'open' | 'eaten';
  started_at: number;
  last_seen_at: number;
  gone_at: number | null;
  concluded_at: number | null;
  reason: string;
  bites: number;
  sightings: string[];
  image_url: string | null;
  summary: string;
};
export type VoiceStatus = {
  deepgram: boolean;
  tts_model: string | null;
  stt_model: string;
  wake_word: string;
};
export type Heard = {
  transcript: string;
  directed: boolean;
  question: string;
  confidence: number;
  seconds: number;
};
export type VoiceReply = {
  answer: Answer | null;
  spoken: string;
  speech_url: string | null;
};
export const AUTH_REQUIRED_EVENT = 'rewind:authentication-required';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isAuthenticationError(problem: unknown): problem is ApiError {
  return problem instanceof ApiError && problem.status === 401;
}

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
      const detail = ((await r.json()) as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail) message = detail;
    } catch {}
    if (r.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(r.status, message);
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
  if (recording.source === 'notch') return 'Notch source · last synced';
  if (recording.clock_quality === 'synthetic')
    return 'import timeline · real capture time unknown';
  if (recording.clock_quality === 'imported') return 'imported capture time';
  if (recording.clock_quality === 'received_only')
    return 'capture time unknown · receive time';
  return 'device timestamp';
}
export function bytes(n: number) {
  return n < 1e6
    ? `${(n / 1e3).toFixed(0)} KB`
    : n < 1e9
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${(n / 1e9).toFixed(1)} GB`;
}
