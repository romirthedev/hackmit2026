'use client';
import { useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LoaderCircle,
} from 'lucide-react';
import { Brand } from '@/components/brand';
export default function Login() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (connecting) return;
    setError('');
    setConnecting(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!r.ok)
        throw Error(
          r.status === 401
            ? 'That key doesn’t match this workspace. Check it and try again.'
            : 'Your server isn’t available right now. Please try again.',
        );
      window.location.reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to connect. Please try again.',
      );
      setConnecting(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <Brand />
      </div>
      <section className="login-card" aria-labelledby="login-title">
        <span className="login-icon">
          <LockKeyhole size={23} strokeWidth={1.6} />
        </span>
        <h1 id="login-title">Welcome to your memory.</h1>
        <p>One place for the moments you want to come back to.</p>
        <form onSubmit={connect}>
          <label htmlFor="token">Workspace access key</label>
          <div className="key-field">
            <input
              id="token"
              type={showKey ? 'text' : 'password'}
              required
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setError('');
              }}
              placeholder="Enter your access key"
              autoComplete="current-password"
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : 'key-help'}
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
          {error && (
            <p id="login-error" className="login-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="login-submit"
            type="submit"
            disabled={connecting || !token.trim()}
          >
            {connecting ? (
              <>
                <LoaderCircle size={17} className="spin" /> Opening workspace…
              </>
            ) : (
              <>
                Open workspace <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <details className="key-help" id="key-help">
          <summary>Where do I find my key?</summary>
          <p>
            On your REWIND server, open the <code>.env</code> file and copy the
            value next to <code>REWIND_ADMIN_TOKEN</code>. Your device key is
            different.
          </p>
        </details>
      </section>
      <p className="login-footer">
        <LockKeyhole size={13} /> Access to this workspace is protected by your
        key.
      </p>
    </main>
  );
}
