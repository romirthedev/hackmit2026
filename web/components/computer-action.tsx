'use client';
import { useEffect, useState } from 'react';
import { Monitor, Square } from 'lucide-react';
import { api } from '@/lib/api';
import './connections.css';

type ActionState = {
  request_id?: string;
  state: string;
  steps: { text: string; verify: boolean }[];
  permission?: { id: string; tool: string; detail: string } | null;
};

/** Show only the current request's actual native progress and permission. */
export function ComputerAction({ commandId }: { commandId: string }) {
  const [snapshot, setSnapshot] = useState<ActionState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const poll = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await api<ActionState>('/computer/state', {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (!controller.signal.aborted) {
          setSnapshot(result.request_id === commandId ? result : null);
          setError('');
        }
      } catch (problem) {
        if (!controller.signal.aborted)
          setError(String(problem).replace(/^Error: /, ''));
      } finally {
        loading = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [commandId]);
  async function act(route: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/computer/' + route, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSnapshot(null);
    } catch (problem) {
      setError(String(problem).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  }
  const current = snapshot?.request_id === commandId ? snapshot : null;
  return (
    <section
      className="computer-progress"
      aria-label="Computer action"
      aria-live="polite"
    >
      <div className="computer-progress-heading">
        <span>
          <Monitor size={16} /> On your Mac
        </span>
        <button
          type="button"
          disabled={
            busy ||
            !current ||
            ['idle', 'responding', 'error'].includes(current.state)
          }
          onClick={() => void act('cancel', { id: commandId })}
        >
          <Square size={13} /> Stop
        </button>
      </div>
      {current?.steps?.slice(-3).map((step, i) => (
        <p key={i}>
          {step.verify ? 'Checking: ' : ''}
          {step.text}
        </p>
      ))}
      {current?.permission && (
        <div className="computer-decision">
          <strong>Your decision is needed</strong>
          <p>{current.permission.tool}</p>
          <pre>{current.permission.detail}</pre>
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act('permission', {
                  id: current.permission!.id,
                  allow: false,
                })
              }
            >
              Deny
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act('permission', {
                  id: current.permission!.id,
                  allow: true,
                })
              }
            >
              Allow once
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
