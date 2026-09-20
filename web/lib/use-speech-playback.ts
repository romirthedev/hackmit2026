'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_REQUIRED_EVENT } from './api';
import { ServerSpeech } from './server-speech';

function playbackError(code: string) {
  if (code === 'not-allowed')
    return 'Your browser blocked the voice. Press Retry voice to allow playback.';
  if (code === 'audio-busy' || code === 'audio-hardware')
    return 'Audio output is unavailable. Check your speakers or headphones, then retry.';
  if (code === 'start-timeout')
    return 'The voice did not start. Check your sound output, then press Retry voice.';
  return 'The voice could not play. Press Retry voice, or try Safari or Chrome on your device.';
}

function stopNativeSpeech() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Native output errors must not prevent session cancellation or cleanup.
  }
}

// Keep an utterance alive until the browser actually finishes speaking it.
// Enqueuing speech is not proof of delivery: browsers may reject it or stall.
export function useSpeechPlayback() {
  const server = useRef<ServerSpeech | null>(null);
  const epoch = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const active = useRef<{
    utterance: SpeechSynthesisUtterance;
    finish: (success: boolean, error?: string) => void;
  } | null>(null);
  const failedText = useRef('');
  const allowed = useRef(true);

  const cancel = useCallback(() => {
    epoch.current++;
    server.current?.cancel();
    setSpeaking(false);
    const current = active.current;
    if (!current) return;
    current.finish(false);
    stopNativeSpeech();
  }, []);

  const speak = useCallback(
    (raw: string): Promise<boolean> => {
      cancel();
      const text = raw.replace(/\[[0-9a-f-]{36}\]/gi, '').trim();
      if (!text || !allowed.current || document.hidden)
        return Promise.resolve(false);
      failedText.current = text;
      setSpeechError('');
      if (server.current?.enabled) {
        if (navigator.userActivation?.isActive) server.current.unlock();
        const current = epoch.current;
        return server.current
          .speak(text, () => setSpeaking(true))
          .then((ok) => {
            if (current !== epoch.current) return false;
            setSpeaking(false);
            if (ok) failedText.current = '';
            else
              setSpeechError(
                'Voice could not play. Press Retry voice to try again.',
              );
            return ok;
          });
      }
      if (
        !window.speechSynthesis ||
        typeof SpeechSynthesisUtterance === 'undefined'
      ) {
        setSpeechError(
          'Voice playback is unavailable in this browser. Try Safari or Chrome on your device.',
        );
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const synth = window.speechSynthesis;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.volume = 1;
        utterance.rate = 1;
        const session = {
          started: false,
          settled: false,
          timer: undefined as ReturnType<typeof setTimeout> | undefined,
        };
        const finish = (success: boolean, error?: string) => {
          if (session.settled) return;
          session.settled = true;
          clearTimeout(session.timer);
          utterance.onstart = null;
          utterance.onend = null;
          utterance.onerror = null;
          active.current = null;
          setSpeaking(false);
          if (success) failedText.current = '';
          if (error) setSpeechError(playbackError(error));
          resolve(success);
        };
        active.current = { utterance, finish };
        utterance.onstart = () => {
          session.started = true;
          setSpeaking(true);
          clearTimeout(session.timer);
          session.timer = setTimeout(
            () => {
              finish(false, 'finish-timeout');
              stopNativeSpeech();
            },
            Math.min(180000, Math.max(20000, text.length * 100)),
          );
        };
        utterance.onend = () =>
          finish(
            session.started,
            session.started ? undefined : 'start-timeout',
          );
        utterance.onerror = (event) =>
          finish(
            false,
            ['canceled', 'interrupted'].includes(event.error)
              ? undefined
              : event.error,
          );
        session.timer = setTimeout(() => {
          finish(false, 'start-timeout');
          stopNativeSpeech();
        }, 5000);
        try {
          // This function is deliberately synchronous up to speak(), allowing
          // click/submit handlers to satisfy browser gesture requirements.
          synth.cancel();
          synth.resume();
          synth.speak(utterance);
        } catch {
          finish(false, 'synthesis-failed');
        }
      });
    },
    [cancel],
  );

  const retry = useCallback(() => speak(failedText.current), [speak]);
  useEffect(() => {
    allowed.current = true;
    const remote = new ServerSpeech();
    server.current = remote;
    const revoke = () => {
      allowed.current = false;
      failedText.current = '';
      cancel();
    };
    const hide = () => {
      if (document.hidden && (active.current || server.current?.active)) {
        setSpeechError(
          'Voice paused while this tab was hidden. Press Retry voice to hear it.',
        );
        cancel();
      }
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, revoke);
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, revoke);
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', hide);
      cancel();
      remote.cancel();
      server.current = null;
    };
  }, [cancel]);
  const unlock = useCallback(() => server.current?.unlock(), []);
  return { unlock, speak, cancel, retry, speaking, speechError };
}

export type SpeechPlayback = ReturnType<typeof useSpeechPlayback>;
