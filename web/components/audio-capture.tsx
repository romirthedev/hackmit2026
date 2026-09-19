'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { api } from '@/lib/api';
export function AudioCapture({
  question = false,
  onUpdate,
  onError,
}: {
  question?: boolean;
  onUpdate: () => void;
  onError: (s: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error('Microphone access requires localhost or HTTPS.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      let parts: Blob[] = [];
      const at = Date.now() / 1000;
      const boot = crypto.randomUUID();
      rec.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data);
      };
      rec.onstop = async () => {
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
          onUpdate();
        } catch (e) {
          onError(String(e));
        } finally {
          setSending(false);
        }
      };
      rec.start();
      setActive(true);
      timer.current = setTimeout(
        () => {
          if (rec.state === 'recording') rec.stop();
        },
        question ? 30000 : 60000,
      );
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      onError(String(e));
    }
  }
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }
  return (
    <button
      className={active ? 'recording-button' : 'quiet'}
      disabled={sending}
      onClick={active ? stop : start}
    >
      {active ? <Square size={16} /> : <Mic size={16} />}{' '}
      {sending
        ? 'Saving…'
        : active
          ? 'Stop & save'
          : question
            ? 'Ask aloud'
            : 'Record conversation'}
    </button>
  );
}
