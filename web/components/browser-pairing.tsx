'use client';
import { Card } from '@/components/ui/card';
import { CatalogButton } from '@/components/catalog';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import QRCode from 'qrcode';
import { FrameImage } from '@/components/catalog';

type Invitation = {
  code?: string;
  direct?: boolean;
  ticket?: string;
  expires_at: number | null;
  public_url?: string;
};

export function BrowserPairing() {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const [localLink, setLocalLink] = useState(false);
  const [qr, setQr] = useState('');
  const [phoneLink, setPhoneLink] = useState('');
  useEffect(() => {
    if (!invitation) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [invitation]);
  const remaining = invitation?.direct
    ? Infinity
    : invitation
      ? Math.max(0, Math.ceil((invitation.expires_at ?? 0) - now))
      : 0;
  async function create() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const result = await api<Invitation>('/pairing', { method: 'POST' });
      setNow(Date.now() / 1000);
      const origin = result.public_url || window.location.origin;
      const link =
        origin.replace(/\/$/, '') +
        '/phone/' +
        (result.direct ? '' : '#connect=' + result.ticket);
      setPhoneLink(link);
      setLocalLink(
        ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname),
      );
      setQr(
        await QRCode.toDataURL(link, {
          width: 280,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#20172d', light: '#ffffff' },
        }),
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
      await navigator.clipboard.writeText(phoneLink);
      setCopied(true);
    } catch {
      setError(
        'Copying is unavailable here. Scan the QR code above to open your phone.',
      );
    }
  }
  return (
    <Card className="card browser-pairing-card">
      <span className="section-icon">
        <Link2 size={20} />
      </span>
      <h2>Connect your phone</h2>
      <p className="muted">
        Scan the code with your phone, then tap Record to start remembering your
        day.
      </p>
      {invitation && (
        <div className={'pairing-invitation ' + (!remaining ? 'expired' : '')}>
          {remaining > 0 && qr && (
            <FrameImage
              className="phone-pairing-qr"
              src={qr}
              alt="Scan to securely connect your phone"
              width={240}
              height={240}
              style={{ borderRadius: 16, margin: '16px auto' }}
            />
          )}
          {remaining > 0 && localLink && (
            <p className="error-text">
              This address works only on this computer. Use the HTTPS phone link
              before scanning.
            </p>
          )}
          <span className="meta">
            {invitation.direct
              ? 'Opens directly · no sign-in or code needed'
              : remaining
                ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} · works once`
                : 'Create a new QR code to connect.'}
          </span>
          {remaining > 0 && (
            <CatalogButton
              type="button"
              className="quiet"
              onClick={() => void copyLink()}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied
                ? 'Phone link copied'
                : localLink
                  ? 'Copy link for this computer'
                  : 'Copy phone link'}
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
            ? 'Create a new QR code'
            : 'Create phone QR code'}
      </CatalogButton>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <p className="meta">
        {invitation?.direct
          ? 'Scan this QR any time to open the phone recorder.'
          : 'Only the newest invitation works.'}{' '}
        Camera and microphone recording requires HTTPS.
      </p>
    </Card>
  );
}
