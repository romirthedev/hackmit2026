'use client';
import { useEffect, useState } from 'react';
import { ArrowUp, Monitor, Square } from 'lucide-react';
import { api } from '@/lib/api';

type Snapshot = {
  connected: boolean;
  accessibility_granted: boolean;
  screen_recording_granted: boolean;
  request_id: string;
  state: string;
  transcript: string;
  response: string;
  error: string;
  success: boolean;
  steps: { text: string; verify: boolean }[];
  permission: { id: string; tool: string; detail: string } | null;
  recent: {
    id: string;
    text: string;
    status: string;
    snapshot: { response?: string; error?: string };
  }[];
};
export function ComputerPanel({ visible }: { visible: boolean }) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const poll = async () => {
      try {
        const next = await api<Snapshot>('/computer/state');
        if (alive) {
          setState(next);
          setConnectionError('');
        }
      } catch (problem) {
        if (alive) setConnectionError(String(problem));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [visible]);
  async function send(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !text.trim()) return;
    setSending(true);
    setError('');
    try {
      const result = await api<{ status: string }>('/computer/command', {
        method: 'POST',
        body: JSON.stringify({ id: crypto.randomUUID(), text }),
      });
      if (result.status === 'accepted') setText('');
      else
        setError(
          'Delivery status: ' +
            result.status +
            '. Check Notch before sending again.',
        );
    } catch (problem) {
      setError(String(problem));
    } finally {
      setSending(false);
    }
  }
  async function action(path: string, body: object) {
    setError('');
    try {
      await api('/computer/' + path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (problem) {
      setError(String(problem));
    }
  }
  return (
    <section className="phone-computer phone-ask">
      <div className="phone-intro">
        <Monitor size={28} />
        <h1>
          A hand with
          <br />
          <em>your computer.</em>
        </h1>
        <p>
          Tell Notch what to do on your Mac. Type here, or use your phone
          keyboard’s microphone to dictate.
        </p>
      </div>
      <p className="phone-fine">
        {connectionError ||
          (state?.connected
            ? 'Connected to Notch on your Mac'
            : 'Connecting to Notch…')}
      </p>
      {state?.connected &&
        (!state.accessibility_granted || !state.screen_recording_granted) && (
          <p className="phone-fine">
            File and terminal actions are available. To control app windows,
            enable Notch’s Accessibility and Screen Recording permissions in
            your Mac’s System Settings.
          </p>
        )}
      <form onSubmit={send}>
        <input
          aria-label="Command for your computer"
          placeholder="Open my calendar for tomorrow"
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          aria-label="Send to Notch"
          disabled={sending || !text.trim() || !!connectionError}
        >
          <ArrowUp size={22} />
        </button>
      </form>
      {error && (
        <p role="alert" className="phone-error">
          {error}
        </p>
      )}
      {state && (
        <article className="phone-answer" aria-live="polite">
          <div>
            <strong>{state.state}</strong>
          {state.request_id && !['idle', 'responding', 'error'].includes(state.state) && (
              <button
                aria-label="Cancel Notch command"
                onClick={() => void action('cancel', { id: state.request_id })}
              >
                <Square size={18} /> Stop
              </button>
            )}
          </div>
          <h3>{state.transcript}</h3>
          {state.steps?.map((step, i) => (
            <p key={i}>
              {step.verify ? 'Checking: ' : ''}
              {step.text}
            </p>
          ))}
          {state.response && <p>{state.response}</p>}
          {state.error && <p className="phone-error">{state.error}</p>}
          {state.permission && (
            <aside className="phone-permission">
              <strong>Notch needs your decision</strong>
              <p>{state.permission.tool}</p>
              <pre>{state.permission.detail}</pre>
              <button
                onClick={() =>
                  void action('permission', {
                    id: state.permission!.id,
                    allow: false,
                  })
                }
              >
                Deny
              </button>
              <button
                onClick={() =>
                  void action('permission', {
                    id: state.permission!.id,
                    allow: true,
                  })
                }
              >
                Allow once
              </button>
            </aside>
          )}
        </article>
      )}
      {state?.recent?.slice(0, 5).map((command) => (
        <details className="phone-answer" key={command.id}>
          <summary>{command.text}</summary>
          <small>{command.status}</small>
          <p>
            {command.snapshot.response ||
              command.snapshot.error ||
              'No completion result received yet.'}
          </p>
        </details>
      ))}
      <p className="phone-fine">
        Your Mac must stay awake with Notch running. Commands use Notch’s
        current permissions and connected apps.
      </p>
    </section>
  );
}
