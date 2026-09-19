'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Link2,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { Brand } from '@/components/brand';

export default function Login() {
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(true);
  const linkStarted = useRef(false);
  const pending = useRef(false);
  const connect = useCallback(async (path: string, body: object) => {
    if (pending.current) return;
    pending.current = true;
    setError('');
    setConnecting(true);
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        let detail = 'Unable to connect. Please try again.';
        try {
          const payload = (await r.json()) as { detail?: unknown };
          if (typeof payload.detail === 'string') detail = payload.detail;
        } catch {}
        throw Error(detail);
      }
      window.location.reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to connect. Please try again.',
      );
      pending.current = false;
      setConnecting(false);
    }
  }, []);
  useEffect(() => {
    if (linkStarted.current) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#connect=')) return;
    linkStarted.current = true;
    const ticket = hash.slice('#connect='.length);
    // The invitation stays out of server logs, referrers, and subsequent browser history.
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
    // oxlint-disable-next-line react/react-compiler -- Redeem the explicit sign-in link once.
    void connect('/api/pair', { ticket, remember: true });
  }, [connect]);
  return (
    <main className="login-page">
      <div className="login-brand">
        <Brand />
      </div>
      <section
        className="login-card pairing-login"
        aria-labelledby="login-title"
      >
        <span className="login-icon">
          <Link2 size={24} strokeWidth={1.6} />
        </span>
        <span className="login-eyebrow">A SIMPLE HELLO</span>
        <h1 id="login-title">Your memory, one step away.</h1>
        <p>
          Open your sign-in link, or enter a pairing code from your REWIND
          computer.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void connect('/api/pair', { code, remember });
          }}
        >
          <label htmlFor="pairing-code">Pairing code</label>
          <input
            id="pairing-code"
            className="pairing-code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="0000 0000"
            pattern="[0-9]{8}"
            maxLength={9}
            required
            value={code}
            disabled={connecting}
            onChange={(e) => {
              setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 8));
              setError('');
            }}
            aria-invalid={!!error}
            aria-describedby={error ? 'login-error' : 'pairing-help'}
          />
          <label className="remember-browser">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={connecting}
            />
            Keep me signed in for 30 days
          </label>
          {error && (
            <p id="login-error" className="login-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="login-submit"
            type="submit"
            disabled={connecting || code.length !== 8}
          >
            {connecting ? (
              <>
                <LoaderCircle size={17} className="spin" /> Opening workspace…
              </>
            ) : (
              <>
                Connect to my memory <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <div className="pairing-help" id="pairing-help">
          <strong>Already connected somewhere?</strong>
          <p>
            Open Device &amp; storage → Connect another browser to get a code.
            It expires after 10 minutes.
          </p>
        </div>
        <details className="key-help">
          <summary>First time connecting?</summary>
          <p>
            On the computer running REWIND, run this from the project folder. It
            opens a sign-in link and shows a pairing code.
          </p>
          <code className="setup-command">
            python scripts/open_workspace.py
          </code>
          <p>
            Use the Python environment from setup. On a Mac, you can also
            double-click <strong>Open REWIND.command</strong>.
          </p>
        </details>
        <details className="key-help advanced-login">
          <summary>Advanced: use an access key</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect('/api/login', { token: token.trim(), remember });
            }}
          >
            <label htmlFor="token">Workspace access key</label>
            <div className="key-field">
              <input
                id="token"
                type={showKey ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                placeholder="Workspace access key"
                autoComplete="current-password"
                disabled={connecting}
              />
              <button
                type="button"
                className="quiet icon-button"
                aria-label={showKey ? 'Hide access key' : 'Show access key'}
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <button
              type="submit"
              className="login-submit quiet"
              disabled={connecting || !token.trim()}
            >
              Open with access key
            </button>
          </form>
        </details>
      </section>
      <p className="login-footer">
        <ShieldCheck size={14} />A private connection to your personal
        workspace.
      </p>
    </main>
  );
}
