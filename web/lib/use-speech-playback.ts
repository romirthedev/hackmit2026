'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_REQUIRED_EVENT } from './api';
import { ServerSpeech } from './server-speech';

// The surface owns retry policy; ServerSpeech owns the browser audio lifecycle.
export function useSpeechPlayback() {
  const server = useRef<ServerSpeech | null>(null);
  const epoch = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const failedText = useRef('');
  const allowed = useRef(true);

  const cancel = useCallback(() => {
    epoch.current++;
    server.current?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (raw: string): Promise<boolean> => {
      cancel();
      const text = raw.replace(/\[[0-9a-f-]{36}\]/gi, '').trim();
      if (!text || !allowed.current || document.hidden || !server.current)
        return Promise.resolve(false);
      failedText.current = text;
      setSpeechError('');
      const playback = server.current;
      if (navigator.userActivation?.isActive) playback.unlock();
      const current = epoch.current;
      return playback
        .speak(text, () => {
          if (current === epoch.current) setSpeaking(true);
        })
        .then((ok) => {
          if (current !== epoch.current) return false;
          setSpeaking(false);
          if (ok) failedText.current = '';
          else
            setSpeechError(
              playback.error ||
                'Voice could not play. Tap Retry voice to try again.',
            );
          return ok;
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
      if (document.hidden && remote.active) {
        setSpeechError(
          'Voice paused while this tab was hidden. Tap Retry voice to hear it.',
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
      remote.dispose();
      server.current = null;
    };
  }, [cancel]);
  const unlock = useCallback(() => server.current?.unlock(), []);
  return { unlock, speak, cancel, retry, speaking, speechError };
}

export type SpeechPlayback = ReturnType<typeof useSpeechPlayback>;
