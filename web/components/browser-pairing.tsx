'use client';
import { Card } from '@/components/ui/card';
import { CatalogButton } from '@/components/catalog';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

type Invitation = { code: string; ticket: string; expires_at: number };

export function BrowserPairing() {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const [localLink, setLocalLink] = useState(false);
  useEffect(() => {
    if (!invitation) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [invitation]);
  const remaining = invitation
    ? Math.max(0, Math.ceil(invitation.expires_at - now))
    : 0;
  async function create() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const result = await api<Invitation>('/pairing', { method: 'POST' });
      setNow(Date.now() / 1000);
      setLocalLink(
        ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname),
      );
      setInvitation(result);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  }
  async function copyLink() {
    if (!invitation || !remaining) return;
    try {
      await navigator.clipboard.writeText(
        window.location.origin + '/#connect=' + invitation.ticket,
      );
      setCopied(true);
    } catch {
      setError(
        'Copying is unavailable here. Enter the pairing code in the other browser.',
      );
    }
  }
  return (
    <Card className="card browser-pairing-card">
      <span className="section-icon">
        <Link2 size={20} />
      </span>
      <h2>Connect another browser</h2>
      <p className="muted">
        Open this workspace’s address in another browser and enter a short code.
        Or send yourself a one-click sign-in link.
      </p>
      {invitation && (
        <div className={'pairing-invitation ' + (!remaining ? 'expired' : '')}>
          <span className="meta">
            {remaining
              ? 'YOUR ONE-TIME PAIRING CODE'
              : 'THIS INVITATION HAS EXPIRED'}
          </span>
          <strong
            aria-label={'Pairing code ' + invitation.code.split('').join(' ')}
          >
            {remaining ? invitation.code : '••••–••••'}
          </strong>
          <span className="meta">
            {remaining
              ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} · works once`
              : 'Create a new code to connect.'}
          </span>
          {remaining > 0 && (
            <CatalogButton
              type="button"
              className="quiet"
              onClick={() => void copyLink()}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied
                ? 'Sign-in link copied'
                : localLink
                  ? 'Copy link for this computer'
                  : 'Copy sign-in link'}
            </CatalogButton>
          )}
        </div>
      )}
      <CatalogButton
        type="button"
        disabled={busy}
        onClick={() => void create()}
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : invitation ? (
          <RefreshCw size={16} />
        ) : (
          <Link2 size={16} />
        )}
        {busy
          ? 'Creating…'
          : invitation
            ? 'Create a new code'
            : 'Get pairing code'}
      </CatalogButton>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <p className="meta">
        Only the newest invitation works. Share it only with a browser you want
        to connect. For another computer, use the server’s LAN address or your
        existing SSH tunnel.
      </p>
    </Card>
  );
}
