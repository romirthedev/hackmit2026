'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  AUTH_REQUIRED_EVENT,
  isAuthenticationError,
  type Alert,
  type Answer,
  type Recording,
  type Rule,
  type Status,
} from '@/lib/api';

export type Connection = 'checking' | 'live' | 'signed-out' | 'offline';
export type ContextGraph = {
  nodes: {
    id: string;
    label: string;
    kind: string;
    source: string;
    document_id?: string;
  }[];
  status: {
    configured: boolean;
    enabled: boolean;
    stale: boolean;
    last_sync: number | null;
    sources: Record<string, string>;
    counts: Record<string, number>;
    error: string;
  };
};
export type Reminder = {
  id: string;
  document_id: string;
  message: string;
  starts_at: number;
  seen: number;
};
export type ConfirmedPerson = {
  id: string;
  name: string;
  evidence: { media_id: string; media_url: string; captured_at: number }[];
};
type Snapshot = {
  status: Status;
  records: Recording[];
  answers: Answer[];
  rules: Rule[];
  alerts: Alert[];
  graph: ContextGraph;
  reminders: Reminder[];
  people: ConfirmedPerson[];
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function useRewind() {
  const [connection, setConnection] = useState<Connection>('checking');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [arrivals, setArrivals] = useState<Recording[]>([]);
  const alive = useRef(false);
  const blocked = useRef(false);
  const epoch = useRef(0);
  const revision = useRef(0);
  const polling = useRef<Promise<void> | null>(null);
  const requests = useRef(new Set<AbortController>());
  const seen = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const lock = useCallback(() => {
    if (blocked.current) return;
    blocked.current = true;
    epoch.current += 1;
    requests.current.forEach((controller) => controller.abort());
    if (timer.current) clearInterval(timer.current);
    if (alive.current) {
      setSnapshot(null);
      setArrivals([]);
      setLastSync(null);
      setError('');
      setConnection('signed-out');
    }
  }, []);

  const reload = useCallback((): Promise<void> => {
    if (!alive.current || blocked.current) return Promise.resolve();
    if (polling.current) return polling.current;
    const controller = new AbortController();
    requests.current.add(controller);
    const current = epoch.current,
      version = revision.current;
    const init = { signal: controller.signal };
    const task = (async () => {
      try {
        const [
          status,
          records,
          answers,
          rules,
          alerts,
          graph,
          reminders,
          persons,
        ] = await Promise.all([
          api<Status>('/status', init),
          api<Recording[]>('/recordings?limit=24', init),
          api<Answer[]>('/answers', init),
          api<Rule[]>('/rules', init),
          api<Alert[]>('/alerts', init),
          api<ContextGraph>('/context/graph', init),
          api<Reminder[]>('/context/reminders', init),
          api<{ people: ConfirmedPerson[] }>('/people', init),
        ]);
        if (
          !alive.current ||
          blocked.current ||
          current !== epoch.current ||
          version !== revision.current
        )
          return;
        const timestamp = Date.now() / 1000;
        setSnapshot({
          status,
          records,
          answers,
          rules,
          alerts,
          graph,
          reminders,
          people: persons.people,
        });
        setNow(timestamp);
        setLastSync(timestamp);
        setConnection('live');
        setError('');
        if (seen.current) {
          const known = seen.current;
          const fresh = records.filter(
            (record) =>
              !known.has(record.id) &&
              record.kind === 'frame' &&
              record.media_url,
          );
          if (fresh.length)
            setArrivals((previous) =>
              [...previous, ...fresh.slice(0, 3)].slice(-4),
            );
        }
        seen.current = new Set(records.map((record) => record.id));
      } catch (problem) {
        if (isAuthenticationError(problem)) lock();
        else if (
          alive.current &&
          !blocked.current &&
          current === epoch.current &&
          !controller.signal.aborted
        ) {
          setError(message(problem));
          setConnection('offline');
        }
      } finally {
        controller.abort();
        requests.current.delete(controller);
      }
    })();
    polling.current = task;
    void task.finally(() => {
      if (polling.current === task) polling.current = null;
    });
    return task;
  }, [lock]);

  useEffect(() => {
    alive.current = true;
    const activeRequests = requests.current;
    window.addEventListener(AUTH_REQUIRED_EVENT, lock);
    if (window.location.hash.startsWith('#connect=')) {
      lock();
    } else {
      void reload();
      timer.current = setInterval(() => {
        setNow(Date.now() / 1000);
        void reload();
      }, 3000);
    }
    return () => {
      alive.current = false;
      epoch.current += 1;
      window.removeEventListener(AUTH_REQUIRED_EVENT, lock);
      if (timer.current) clearInterval(timer.current);
      activeRequests.forEach((controller) => controller.abort());
      polling.current = null;
    };
  }, [lock, reload]);

  const change = useCallback(
    async <T>(path: string, init: RequestInit): Promise<T> => {
      if (blocked.current || !alive.current)
        throw new Error('Sign in to continue.');
      const current = epoch.current;
      const controller = new AbortController();
      requests.current.add(controller);
      try {
        const result = await api<T>(path, {
          ...init,
          signal: controller.signal,
        });
        if (!alive.current || blocked.current || current !== epoch.current)
          throw new Error('Session ended. Sign in to continue.');
        revision.current += 1;
        setError('');
        return result;
      } catch (problem) {
        if (isAuthenticationError(problem)) lock();
        if (alive.current && !blocked.current && current === epoch.current)
          setError(message(problem));
        throw problem;
      } finally {
        requests.current.delete(controller);
      }
    },
    [lock],
  );
  const ask = useCallback(
    async (question: string) => {
      const answer = await change<Answer>('/ask', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              answers: [
                answer,
                ...previous.answers.filter((item) => item.id !== answer.id),
              ],
            }
          : previous,
      );
      return answer;
    },
    [change],
  );
  const action = useCallback(
    async (path: string, init: RequestInit = { method: 'POST' }) => {
      await change(path, init);
      if (polling.current) await polling.current;
      await reload();
    },
    [change, reload],
  );
  const logout = useCallback(async () => {
    lock();
    try {
      await api('/logout', { method: 'POST' });
      if (alive.current) setError('');
    } catch (problem) {
      if (alive.current && !isAuthenticationError(problem))
        setError(
          `Sign-out failed: ${message(problem)}. This view is locked; retry sign out to end the server session.`,
        );
    }
  }, [lock]);

  return {
    connection,
    status: snapshot?.status ?? null,
    records: snapshot?.records ?? [],
    answers: snapshot?.answers ?? [],
    rules: snapshot?.rules ?? [],
    alerts: snapshot?.alerts ?? [],
    graph: snapshot?.graph ?? null,
    reminders: snapshot?.reminders ?? [],
    people: snapshot?.people ?? [],
    online:
      connection === 'live' &&
      !!snapshot?.status.devices.some((device) => now - device.last_seen < 30),
    now,
    lastSync,
    error,
    arrivals,
    ask,
    logout,
    reload,
    dismissArrival: useCallback(
      (id: string) =>
        setArrivals((previous) => previous.filter((item) => item.id !== id)),
      [],
    ),
    addRule: (instruction: string) =>
      action('/rules', {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      }),
    removeRule: (id: string) =>
      action('/rules/' + encodeURIComponent(id), { method: 'DELETE' }),
    markSeen: (id: string) =>
      action('/alerts/' + encodeURIComponent(id) + '/seen'),
    reminderSeen: (id: string) =>
      action('/context/reminders/' + encodeURIComponent(id) + '/seen'),
    setPaused: (paused: boolean) =>
      action('/capture/pause', {
        method: 'POST',
        body: JSON.stringify({ paused }),
      }),
    retryFailed: () => action('/retry'),
  };
}
