import { mediaAccessError, requestMedia } from './media-access';

// Separate finishing (submit the clip) from cancellation (discard it).
export async function recordUtterance(
  onLevel?: (level: number) => void,
  signal?: AbortSignal,
  finishSignal?: AbortSignal,
  inputStream?: MediaStream,
  onStarted?: () => void,
): Promise<Blob | null> {
  if (signal?.aborted || finishSignal?.aborted) return null;
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      'Microphone access needs HTTPS or localhost. Open the secure Rewind link.',
    );
  if (typeof MediaRecorder === 'undefined')
    throw new Error('This browser cannot record audio. Try Safari or Chrome.');
  // Resume during the tap, before the permission prompt loses user activation.
  const context = new AudioContext();
  const resumed = context.resume().catch(() => {});
  const opening = new AbortController();
  const cancelOpening = () => opening.abort();
  signal?.addEventListener('abort', cancelOpening, { once: true });
  finishSignal?.addEventListener('abort', cancelOpening, { once: true });
  let stream: MediaStream | null = null;
  try {
    stream =
      inputStream ??
      (await requestMedia(
        { audio: { echoCancellation: true, noiseSuppression: true } },
        opening.signal,
      ));
    if (signal?.aborted || finishSignal?.aborted) return null;
    // Some Safari versions keep resume pending until microphone permission is
    // granted. Request the device first, while still in the original gesture.
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelResume: (() => void) | undefined;
    try {
      await Promise.race([
        resumed.then(() =>
          context.state === 'running' ? undefined : context.resume(),
        ),
        new Promise<void>((resolve) => {
          resumeTimer = setTimeout(resolve, 3000);
          cancelResume = () => resolve();
          opening.signal.addEventListener('abort', cancelResume, {
            once: true,
          });
          if (opening.signal.aborted) cancelResume();
        }),
      ]);
    } finally {
      clearTimeout(resumeTimer);
      if (cancelResume)
        opening.signal.removeEventListener('abort', cancelResume);
    }
    if (signal?.aborted || finishSignal?.aborted) return null;
    if (context.state !== 'running')
      throw new Error('Microphone audio is paused. Tap the orb to try again.');
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime } : undefined,
    );
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const monitor = context.createGain();
    monitor.gain.value = 0;
    analyser.connect(monitor);
    monitor.connect(context.destination);
    const data = new Float32Array(analyser.fftSize);
    const parts: Blob[] = [];
    let voiced = 0,
      quietSince = 0,
      noise = 0.002;
    const started = performance.now();
    let previous = started;
    return await new Promise<Blob | null>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (stopTimer) return;
        // A broken recorder must not leave the orb waiting indefinitely.
        stopTimer = setTimeout(() => {
          clean();
          reject(
            new Error(
              'The microphone did not finish. Tap the orb to try again.',
            ),
          );
        }, 3000);
        if (recorder.state === 'recording') recorder.stop();
      };
      const clean = () => {
        clearTimeout(timer);
        clearTimeout(stopTimer);
        signal?.removeEventListener('abort', stop);
        finishSignal?.removeEventListener('abort', stop);
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size) parts.push(event.data);
      };
      recorder.onerror = () => {
        clean();
        reject(new Error('The microphone recording failed. Please try again.'));
      };
      recorder.onstop = () => {
        clean();
        // An explicit finish submits quiet speech too; the transcriber decides
        // whether it contains words. Cancellation never uploads anything.
        resolve(
          parts.length &&
            !signal?.aborted &&
            (voiced >= 180 ||
              (finishSignal?.aborted && performance.now() - started >= 250))
            ? new Blob(parts, {
                type: recorder.mimeType || mime || parts[0].type,
              })
            : null,
        );
      };
      signal?.addEventListener('abort', stop, { once: true });
      finishSignal?.addEventListener('abort', stop, { once: true });
      try {
        recorder.start(250);
        onStarted?.();
      } catch (problem) {
        clean();
        reject(problem);
        return;
      }
      const tick = () => {
        if (recorder.state !== 'recording') return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const sample of data) sum += sample * sample;
        const level = Math.sqrt(sum / data.length);
        onLevel?.(level);
        const now = performance.now();
        if (level > Math.max(0.008, noise * 3)) {
          voiced += Math.min(now - previous, 100);
          quietSince = 0;
        } else {
          if (!voiced) noise = noise * 0.98 + level * 0.02;
          if (!quietSince) quietSince = now;
        }
        previous = now;
        const elapsed = now - started;
        if (
          signal?.aborted ||
          finishSignal?.aborted ||
          (voiced >= 180 && quietSince && now - quietSince >= 1200) ||
          elapsed >= 20000 ||
          (!voiced && elapsed >= 8000)
        )
          stop();
        else timer = setTimeout(tick, 60);
      };
      tick();
    });
  } catch (problem) {
    if (signal?.aborted || finishSignal?.aborted) return null;
    throw new Error(mediaAccessError(problem, 'microphone'));
  } finally {
    signal?.removeEventListener('abort', cancelOpening);
    finishSignal?.removeEventListener('abort', cancelOpening);
    if (!inputStream) stream?.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => {});
  }
}
