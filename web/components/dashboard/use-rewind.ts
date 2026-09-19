'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type Alert,
  type Answer,
  type Recording,
  type Rule,
  type Status,
} from '@/lib/api';
import {
  demoAlerts,
  demoAnswerFor,
  demoAnswers,
  demoRecordings,
  demoRules,
  demoStatus,
} from './demo-data';

export type Connection = 'checking' | 'live' | 'signed-out' | 'demo';

export type Rewind = {
  connection: Connection;
  status: Status;
  records: Recording[];
  answers: Answer[];
  rules: Rule[];
  alerts: Alert[];
  online: boolean;
  now: number;
  error: string;
  ask: (question: string) => Promise<Answer>;
  addRule: (instruction: string) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
  markSeen: (id: string) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  retryFailed: () => Promise<void>;
  reload: () => Promise<void>;
};

// Polls the local REWIND server every 5s. If it is unreachable or the browser
// is not signed in, the dashboard falls back to labelled demo data so the UI
// can still be shown end to end.
export function useRewind(): Rewind {
  const [connection, setConnection] = useState<Connection>('checking');
  const [status, setStatus] = useState<Status>(demoStatus);
  const [records, setRecords] = useState<Recording[]>(demoRecordings);
  const [answers, setAnswers] = useState<Answer[]>(demoAnswers);
  const [rules, setRules] = useState<Rule[]>(demoRules);
  const [alerts, setAlerts] = useState<Alert[]>(demoAlerts);
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  const live = useRef(false);

  const reload = useCallback(async () => {
    try {
      const [s, r, a, ru, al] = await Promise.all([
        api<Status>('/status'),
        api<Recording[]>('/recordings?limit=24'),
        api<Answer[]>('/answers'),
        api<Rule[]>('/rules'),
        api<Alert[]>('/alerts'),
      ]);
      live.current = true;
      setNow(Date.now() / 1000);
      setStatus(s);
      setRecords(r);
      setAnswers(a);
      setRules(ru);
      setAlerts(al);
      setConnection('live');
      setError('');
    } catch (e) {
      live.current = false;
      setNow(Date.now() / 1000);
      setConnection(String(e).includes('access key') ? 'signed-out' : 'demo');
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- synchronize with the external recording server
    void reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(String(e).replace(/^Error: /, ''));
      }
    },
    [reload],
  );

  const ask = useCallback(async (question: string): Promise<Answer> => {
    if (live.current) {
      const a = await api<Answer>('/ask', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setAnswers((prev) => [a, ...prev.filter((v) => v.id !== a.id)]);
      return a;
    }
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 600));
    const a: Answer = {
      id: 'demo-' + Date.now(),
      question,
      answer: demoAnswerFor(question),
      evidence: [],
      created_at: Date.now() / 1000,
      grounded: true,
      mode: 'typed',
    };
    setAnswers((prev) => [a, ...prev]);
    return a;
  }, []);

  const addRule = useCallback(
    async (instruction: string) => {
      if (live.current)
        return run(() =>
          api('/rules', {
            method: 'POST',
            body: JSON.stringify({ instruction }),
          }),
        );
      setRules((prev) => [
        { id: 'demo-' + Date.now(), instruction, enabled: 1 },
        ...prev,
      ]);
    },
    [run],
  );

  const removeRule = useCallback(
    async (id: string) => {
      if (live.current)
        return run(() => api('/rules/' + id, { method: 'DELETE' }));
      setRules((prev) => prev.filter((r) => r.id !== id));
    },
    [run],
  );

  const markSeen = useCallback(
    async (id: string) => {
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, seen: 1 } : a)),
      );
      if (live.current)
        await run(() => api('/alerts/' + id + '/seen', { method: 'POST' }));
    },
    [run],
  );

  const setPaused = useCallback(
    async (paused: boolean) => {
      setStatus((s) => ({ ...s, paused }));
      if (live.current)
        await run(() =>
          api('/capture/pause', {
            method: 'POST',
            body: JSON.stringify({ paused }),
          }),
        );
    },
    [run],
  );

  const retryFailed = useCallback(async () => {
    if (live.current) return run(() => api('/retry', { method: 'POST' }));
    setStatus((s) => ({ ...s, failed: 0, pending: s.pending + s.failed }));
  }, [run]);

  const online = now > 0 && status.devices.some((d) => now - d.last_seen < 30);
  return {
    connection,
    status,
    records,
    answers,
    rules,
    alerts,
    online,
    now,
    error,
    ask,
    addRule,
    removeRule,
    markSeen,
    setPaused,
    retryFailed,
    reload,
  };
}
