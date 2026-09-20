/** Cancelable device opening and inline-preview readiness shared by phone capture. */
export function mediaAccessError(problem: unknown, devices: string): string {
  if (problem instanceof Error) {
    if (problem.name === 'NotAllowedError' || problem.name === 'SecurityError')
      return `Allow ${devices} access for this site in your browser settings, then try again.`;
    if (problem.name === 'NotFoundError')
      return `No ${devices} was found. Check that your device has one available.`;
    if (problem.name === 'NotReadableError' || problem.name === 'AbortError')
      return `The ${devices} could not start. Close other apps using it, then try again.`;
    return problem.message;
  }
  return `Unable to open the ${devices}. Please try again.`;
}

export function requestMedia(
  constraints: MediaStreamConstraints,
  signal: AbortSignal,
  timeoutMs = 45000,
): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    return Promise.reject(
      new Error(
        'Open the secure HTTPS phone link to use the camera and microphone.',
      ),
    );
  if (signal.aborted)
    return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  // Call during the user's tap, before storage, locks or network requests await.
  const opening = navigator.mediaDevices.getUserMedia(constraints);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (problem?: Error, stream?: MediaStream) => {
      if (settled) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (problem) reject(problem);
      else resolve(stream!);
    };
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'Device permission is still waiting. Allow access in your browser, then tap again.',
          ),
        ),
      timeoutMs,
    );
    signal.addEventListener('abort', cancel, { once: true });
    opening.then(
      (stream) => finish(undefined, stream),
      (problem) => finish(problem),
    );
  });
}

export async function attachCamera(
  video: HTMLVideoElement,
  stream: MediaStream,
  signal: AbortSignal,
) {
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (problem?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancel);
      if (problem) reject(problem);
      else resolve();
    };
    const ready = () => {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight)
        finish();
    };
    const failed = () =>
      finish(
        new Error(
          'The camera preview could not start. Tap Camera or Record to try again.',
        ),
      );
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(failed, 12000);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else void video.play().then(ready, finish);
  });
}
