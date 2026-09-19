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
import { CatalogButton, MemoryAurora } from '@/components/catalog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp';
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
      <section className="login-story" aria-label="REWIND personal memory">
        <MemoryAurora />
        <Brand />
        <div className="login-story-copy">
          <span className="login-eyebrow">A SECOND LOOK AT YOUR DAY</span>
          <h1>
            Life happens.
            <br />
            <em>Keep the moment.</em>
          </h1>
          <p>
            Your recordings, conversations, and the little things you almost
            forgot. Ready to recall.
          </p>
          <div className="login-story-caption">
            <span className="live-dot" /> YOUR PERSONAL MEMORY
          </div>
        </div>
        <p className="login-story-footer">
          <ShieldCheck size={15} /> Original moments. Answers with evidence.
        </p>
      </section>
      <div className="login-form-side">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <Card className="login-card pairing-login">
          <div className="login-icon">
            <Link2 size={23} />
          </div>
          <span className="login-eyebrow">WELCOME BACK</span>
          <h2 id="login-title">Open your memory.</h2>
          <p>
            Enter your eight-digit pairing code to connect to your REWIND
            workspace.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect('/api/pair', { code, remember });
            }}
          >
            <label htmlFor="pairing-code">Pairing code</label>
            <InputOTP
              id="pairing-code"
              maxLength={8}
              pattern="[0-9]*"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              disabled={connecting}
              onChange={(value) => {
                setCode(value.replace(/[^0-9]/g, '').slice(0, 8));
                setError('');
              }}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : 'pairing-help'}
              containerClassName="pairing-slots"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3].map((index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {[4, 5, 6, 7].map((index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <label htmlFor="remember-browser" className="remember-browser">
              <Checkbox
                id="remember-browser"
                checked={remember}
                onCheckedChange={(value) => setRemember(value === true)}
                disabled={connecting}
              />{' '}
              Keep me signed in for 30 days
            </label>
            {error && (
              <p id="login-error" className="login-error" role="alert">
                {error}
              </p>
            )}
            <CatalogButton
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
                  Open workspace <ArrowRight size={17} />
                </>
              )}
            </CatalogButton>
          </form>
          <p className="pairing-help" id="pairing-help">
            Get a code from{' '}
            <strong>Device &amp; storage → Connect another browser</strong> on
            your connected workspace.
          </p>
          <Accordion className="login-help">
            <AccordionItem value="setup">
              <AccordionTrigger>First time connecting?</AccordionTrigger>
              <AccordionContent>
                <p>
                  On the computer running REWIND, run this from the project
                  folder to open a sign-in link:
                </p>
                <code className="setup-command">
                  python scripts/open_workspace.py
                </code>
                <p>
                  Use the Python environment from setup. On a Mac, you can also
                  double-click <strong>Open REWIND.command</strong>.
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="advanced">
              <AccordionTrigger>Connect with an access key</AccordionTrigger>
              <AccordionContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void connect('/api/login', {
                      token: token.trim(),
                      remember,
                    });
                  }}
                >
                  <label htmlFor="token">Workspace access key</label>
                  <div className="key-field">
                    <Input
                      id="token"
                      type={showKey ? 'text' : 'password'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                      placeholder="Workspace access key"
                      autoComplete="current-password"
                      disabled={connecting}
                    />
                    <CatalogButton
                      type="button"
                      className="quiet icon-button"
                      aria-label={
                        showKey ? 'Hide access key' : 'Show access key'
                      }
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                    </CatalogButton>
                  </div>
                  <CatalogButton
                    type="submit"
                    className="login-submit quiet"
                    disabled={connecting || !token.trim()}
                  >
                    Open with access key
                  </CatalogButton>
                </form>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
        <p className="login-footer">
          <ShieldCheck size={14} /> Connected to your personal workspace.
        </p>
      </div>
    </main>
  );
}
