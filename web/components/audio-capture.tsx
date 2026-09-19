'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
export function AudioCapture({
  question = false,
  disabled = false,
  onUpdate,
  onError,
}: {
  question?: boolean;
  disabled?: boolean;
  onUpdate: () => void;
  onError: (s: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const tick = () =>
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [active]);
  async function start() {
    if (requesting || sending || active) return;
    setRequesting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error('Microphone access requires localhost or HTTPS.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      const mime = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime)
        throw Error(
          'This browser cannot record supported audio. Use Chrome or upload a WAV file.',
        );
      const rec = new MediaRecorder(input, { mimeType: mime });
      recorder.current = rec;
      const parts: Blob[] = [];
      const at = Date.now() / 1000;
      const boot = crypto.randomUUID();
      rec.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      rec.onstop = async () => {
        if (timer.current) clearTimeout(timer.current);
        setActive(false);
        input.getTracks().forEach((t) => t.stop());
        setSending(true);
        try {
          await api('/ingest/audio', {
            method: 'POST',
            headers: {
              'Content-Type': mime.split(';')[0],
              'X-Boot-ID': boot,
              'X-Sequence': '0',
              'X-Captured-At': String(at),
              'X-Intent': question ? 'question' : 'memory',
            },
            body: new Blob(parts, { type: mime }),
          });
          if (mounted.current) onUpdate();
        } catch (e) {
          if (mounted.current) onError(String(e));
        } finally {
          if (mounted.current) setSending(false);
        }
      };
      rec.start();
      startedAt.current = Date.now();
      setElapsed(0);
      setActive(true);
      timer.current = setTimeout(
        () => {
          if (rec.state === 'recording') rec.stop();
        },
        question ? 30000 : 60000,
      );
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (mounted.current) onError(String(e));
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      className={'voice-pill ' + (active ? 'recording-button' : 'quiet')}
      disabled={sending || requesting || (disabled && !active)}
      onClick={active ? stop : start}
    >
      {sending || requesting ? (
        <LoaderCircle size={16} className="spin" />
      ) : active ? (
        <Square size={14} />
      ) : (
        <Mic size={16} />
      )}{' '}
      {requesting
        ? 'Opening mic…'
        : sending
          ? 'Saving…'
          : active
            ? 'Stop & save'
            : question
              ? 'Ask aloud'
              : 'Record conversation'}
      {active && (
        <span
          className="recording-timer"
          aria-label={`${elapsed} seconds recorded, maximum ${question ? 30 : 60} seconds`}
        >
          <i aria-hidden="true" />
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          <span> / {question ? '0:30' : '1:00'}</span>
        </span>
      )}
    </button>
  );
}
