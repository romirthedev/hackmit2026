// Durable source bytes and recording session metadata for the phone upload queue.
export type Chunk = {
  id: string;
  boot: string;
  seq: number;
  kind: 'frame' | 'audio' | 'video' | 'recording_end' | 'conversation_audio';
  at: number;
  blob: Blob;
  intent: 'memory' | 'question' | 'scan';
  recordingStartedAt?: number;
};
export type EndReason =
  | 'stopped'
  | 'hidden'
  | 'interrupted'
  | 'storage_full'
  | 'page_closed';
export type RecordingSession = {
  id: string;
  mime: string;
  startedAt: number;
  lastAt: number;
  chunks: number;
  closed: boolean;
};
export const activeOriginals = new Set<string>();
let dbPromise: Promise<IDBDatabase> | undefined;
export function database() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('rewind-phone-recordings', 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('chunks'))
          req.result.createObjectStore('chunks', { keyPath: 'id' });
        if (!req.result.objectStoreNames.contains('sessions'))
          req.result.createObjectStore('sessions', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return dbPromise;
}
type StoredChunk = Omit<Chunk, 'blob'> & { bytes: ArrayBuffer; mime: string };
type ReadableChunk = StoredChunk | Chunk;

function restore(item: ReadableChunk): Chunk {
  // Keep already-queued recordings from earlier app versions recoverable.
  if ('blob' in item) return item;
  const { bytes, mime, ...metadata } = item;
  return { ...metadata, blob: new Blob([bytes], { type: mime }) };
}

const queuedFirst = (a: ReadableChunk, b: ReadableChunk) =>
  Number(b.intent === 'question') - Number(a.intent === 'question') ||
  a.at - b.at;

export async function chunks(limit = 2): Promise<Chunk[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const selected: ReadableChunk[] = [];
    // Retain at most one upload batch instead of copying a whole offline day
    // into JS memory. A cursor releases each unselected payload immediately.
    const req = db.transaction('chunks').objectStore('chunks').openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(selected.map(restore));
        return;
      }
      selected.push(cursor.value as ReadableChunk);
      selected.sort(queuedFirst);
      if (selected.length > limit) selected.pop();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function queueInfo(): Promise<{ count: number; bytes: number }> {
  const db = await database();
  return new Promise((resolve, reject) => {
    let count = 0,
      bytes = 0;
    const req = db.transaction('chunks').objectStore('chunks').openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve({ count, bytes });
        return;
      }
      const item = cursor.value as ReadableChunk;
      count++;
      bytes += 'blob' in item ? item.blob.size : item.bytes.byteLength;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
export async function write(
  item: Chunk | string,
  session?: RecordingSession | string,
) {
  // Safari can reject Blob values in IndexedDB, particularly private storage.
  // Store the exact encoded bytes plus MIME instead; conversion must finish
  // before opening the transaction (Safari closes idle transactions eagerly).
  const stored =
    typeof item === 'string'
      ? item
      : await (async () => {
          const { blob, ...metadata } = item;
          return {
            ...metadata,
            bytes: await blob.arrayBuffer(),
            mime: blob.type,
          };
        })();
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['chunks', 'sessions'], 'readwrite');
    let requestError: DOMException | null = null;
    const request =
      typeof stored === 'string'
        ? tx.objectStore('chunks').delete(stored)
        : tx.objectStore('chunks').put(stored);
    request.onerror = () => {
      requestError = request.error;
    };
    if (typeof session === 'string') tx.objectStore('sessions').delete(session);
    else if (session) tx.objectStore('sessions').put(session);
    tx.oncomplete = () => resolve();
    const failed = () =>
      reject(
        requestError ||
          tx.error ||
          new Error('Phone storage could not commit these bytes.'),
      );
    tx.onerror = failed;
    tx.onabort = failed;
  });
}

export function endChunk(
  session: RecordingSession,
  reason: EndReason,
  endedAt: number,
): Chunk {
  return {
    id: `finish-${session.id}`,
    boot: session.id,
    seq: session.chunks,
    kind: 'recording_end',
    at: endedAt,
    intent: 'memory',
    blob: new Blob(
      [
        JSON.stringify({
          mime: session.mime,
          started_at: session.startedAt,
          ended_at: Math.max(session.startedAt, endedAt),
          chunks: session.chunks,
          reason,
        }),
      ],
      { type: 'application/json' },
    ),
  };
}

export async function recoverSessions() {
  const db = await database();
  const sessions = await new Promise<RecordingSession[]>((resolve, reject) => {
    const req = db.transaction('sessions').objectStore('sessions').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const session of sessions) {
    if (!session.closed && !activeOriginals.has(session.id)) {
      await write(endChunk(session, 'page_closed', session.lastAt), {
        ...session,
        closed: true,
      });
    }
  }
  return sessions.some(
    (session) => !session.closed && !activeOriginals.has(session.id),
  );
}
