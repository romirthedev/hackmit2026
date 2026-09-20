/** Optional, brief acknowledgement of a deliberate voice-control tap. */
export function voiceTapFeedback() {
  try {
    navigator.vibrate?.(12);
  } catch {
    // Unsupported haptics must never prevent opening or closing the microphone.
  }
}
