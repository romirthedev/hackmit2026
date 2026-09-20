'use client';
import { useEffect, useRef, useState } from 'react';
import { Link2, Monitor, X } from 'lucide-react';
import { api } from '@/lib/api';
import { ContextPanel } from './context-panel';
import './connections.css';

export function Connections({ compact = false }: { compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [computer, setComputer] = useState('Checking your Mac…');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let loading = false;
    const check = async () => {
      if (loading) return;
      loading = true;
      try {
        const state = await api<{
          connected: boolean;
          accessibility_granted: boolean;
          screen_recording_granted: boolean;
        }>('/computer/state', {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (!controller.signal.aborted)
          setComputer(
            state.connected
              ? state.accessibility_granted && state.screen_recording_granted
                ? 'Your Mac is connected. Ask the orb to open apps, find files or help with a task.'
                : 'Your Mac is connected for files and commands. Controlling app windows also needs Notch’s Accessibility and Screen Recording permissions in System Settings.'
              : 'Open Notch on your Mac to connect computer actions.',
          );
      } catch {
        if (!controller.signal.aborted)
          setComputer(
            'Your Mac is disconnected. Open Notch on the Mac to use computer actions.',
          );
      } finally {
        loading = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [open]);
  const close = () => {
    dialog.current?.close();
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className="memory-link connections-link"
        aria-label="Open connected knowledge and computer"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <Link2 size={16} />
        {!compact && <span className="connections-label">Connected life</span>}
      </button>
      <dialog
        ref={dialog}
        className="connections-dialog"
        aria-labelledby="connections-title"
        onClose={() => setOpen(false)}
      >
        <header>
          <h2 id="connections-title">Your world, together.</h2>
          <button type="button" aria-label="Close connections" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {open && (
          <>
            <div className="connections-computer">
              <Monitor size={22} />
              <div>
                <strong>One assistant for your day and your Mac</strong>
                <p>{computer}</p>
                <small>Your Mac must stay awake with Notch running.</small>
              </div>
            </div>
            <ContextPanel />
          </>
        )}
      </dialog>
    </>
  );
}
