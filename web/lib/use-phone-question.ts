'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { api, type Heard } from './api';
import type { PhoneCapture } from './phone-capture';
import { recordUtterance } from './voice';
import { voiceTapFeedback } from './voice-feedback';

/** One explicit question at a time. Ambient recording has its own durable queue. */
export function usePhoneQuestion({
  capture,
  onSubmit,
  onSubmitFailed,
  onError,
  onVoice,
}: {
  capture: RefObject<PhoneCapture | null>;
  onSubmit: (id: string, text: string) => void;
  onSubmitFailed: (id: string) => void;
  onError: (message: string) => void;
  onVoice: () => void;
}) {
  const [phase, setPhase] = useState<
    'idle' | 'starting' | 'listening' | 'hearing' | 'sending'
  >('idle');
  const current = useRef<AbortController | null>(null);
  const finish = useRef<AbortController | null>(null);
  const recordingReady = useRef(false);
  const cancel = () => current.current?.abort();
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) current.current?.abort();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      current.current?.abort();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  async function submit(text: string, signal: AbortSignal) {
    const id = crypto.randomUUID();
    // A state poll can see the completed answer before the POST acknowledgment.
    onSubmit(id, text);
    try {
      await api('/conversation/text', {
        method: 'POST',
        body: JSON.stringify({ id, text }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      });
    } catch (error) {
      onSubmitFailed(id);
      throw error;
    }
  }
  async function sendText(text: string) {
    if (current.current || !text.trim()) return false;
    const request = new AbortController();
    current.current = request;
    setPhase('sending');
    onError('');
    capture.current?.unlockSpeech();
    try {
      await submit(text.trim(), request.signal);
      return !request.signal.aborted;
    } catch (error) {
      if (!request.signal.aborted)
        onError(
          error instanceof Error
            ? error.message
            : 'Your request could not be sent. Please try again.',
        );
      return false;
    } finally {
      if (current.current === request) {
        current.current = null;
        setPhase('idle');
      }
    }
  }
  async function talk() {
    if (current.current) {
      if (finish.current && !finish.current.signal.aborted) {
        voiceTapFeedback();
        if (!recordingReady.current) current.current.abort();
        finish.current.abort();
      }
      return;
    }
    const controller = capture.current;
    if (!controller) return;
    const request = new AbortController();
    const done = new AbortController();
    current.current = request;
    finish.current = done;
    recordingReady.current = false;
    // Commit visible feedback before native audio/permission setup starts.
    flushSync(() => {
      setPhase('starting');
      onError('');
    });
    voiceTapFeedback();
    try {
      onVoice();
      controller.prepareQuestion();
      const clip = await recordUtterance(
        undefined,
        request.signal,
        done.signal,
        controller.microphoneStream(),
        () => {
          if (request.signal.aborted || done.signal.aborted) return;
          recordingReady.current = true;
          setPhase('listening');
        },
      );
      if (request.signal.aborted) return;
      if (!clip)
        throw new Error("I didn't hear anything. Tap the orb and try again.");
      setPhase('hearing');
      const heard = await api<Heard>('/voice/hear?wake=false', {
        method: 'POST',
        headers: { 'Content-Type': clip.type },
        body: clip,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
      });
      if (request.signal.aborted) return;
      if (!heard.question)
        throw new Error("I couldn't hear that clearly. Please try again.");
      await submit(heard.question, request.signal);
    } catch (error) {
      if (!request.signal.aborted)
        onError(
          error instanceof Error
            ? error.message
            : 'Your voice request could not be sent. Please try again.',
        );
    } finally {
      controller.finishQuestion();
      if (current.current === request) {
        current.current = null;
        finish.current = null;
        recordingReady.current = false;
        setPhase('idle');
      }
    }
  }
  return {
    talk,
    sendText,
    cancel,
    starting: phase === 'starting',
    listening: phase === 'listening',
    hearing: phase === 'hearing',
    asking: phase === 'sending',
  };
}
