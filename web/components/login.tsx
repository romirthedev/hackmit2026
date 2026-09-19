'use client';
import { useState } from 'react';
import { ArrowUpRight, Aperture, Radio, Fingerprint } from 'lucide-react';
export default function Login() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) throw Error('The server could not verify this access key.');
      window.location.reload();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main className="shell">
      <header>
        <a className="brand" href="/">
          <Aperture /> REWIND<span className="tag">PERSONAL MEMORY</span>
        </a>
        <span className="status">
          <i /> Local workspace
        </span>
      </header>
      <section className="welcome">
        <div>
          <p className="eyebrow">A RECORD OF YOUR WORLD</p>
          <h1>
            Be here.
            <br />
            <span>Remember later.</span>
          </h1>
          <p className="intro">
            Find the thing you put down. Revisit the conversation that sparked
            an idea. Keep the details that would otherwise slip away.
          </p>
          <div className="system-note">
            <Radio size={20} />
            <span>
              Wireless capture. Private memory. Evidence with every answer.
            </span>
          </div>
        </div>
        <form className="connect-panel" onSubmit={connect}>
          <Fingerprint size={32} />
          <h2>Open your memory</h2>
          <p>Connect to the REWIND server running on your computer.</p>
          <label htmlFor="token">Workspace access key</label>
          <input
            id="token"
            type="password"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter your access key"
          />
          <button type="submit">
            Connect to workspace <ArrowUpRight size={18} />
          </button>
          {error && <p role="alert">{error}</p>}
          <small>Your key is created when you run the setup script.</small>
        </form>
      </section>
      <footer>
        <span>01 / CAPTURE</span>
        <span>02 / REMEMBER</span>
        <span>03 / RECALL</span>
        <span className="muted">Built for a day worth remembering.</span>
      </footer>
    </main>
  );
}
