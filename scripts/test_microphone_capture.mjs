// Microphone lifecycle regression with media API doubles, without a browser or device.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const web = path.resolve("web");
const folder = (await fs.readdir(path.join(web, "node_modules/.pnpm"))).find((n) =>
  n.startsWith("esbuild@"),
);
const esbuild = require(path.join(web, "node_modules/.pnpm", folder, "node_modules/esbuild"));
const result = await esbuild.build({
  entryPoints: [path.join(web, "lib/voice.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { recordUtterance } = await import(
  "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")
);
let acquired = [],
  closed = 0,
  stopped = 0;
globalThis.window = { isSecureContext: true };
const track = {
  stop() {
    stopped++;
  },
};
const stream = { getTracks: () => [track] };
Object.defineProperty(globalThis, "navigator", {
  value: {
    mediaDevices: {
      getUserMedia: async (options) => {
        acquired.push(options);
        return stream;
      },
    },
  },
  configurable: true,
});
globalThis.AudioContext = class {
  state = "running";
  async resume() {}
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return {
      connect() {},
      getFloatTimeDomainData(data) {
        data.fill(0);
      },
    };
  }
  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }
  async close() {
    closed++;
  }
};
globalThis.MediaRecorder = class {
  static isTypeSupported(type) {
    return type === "audio/webm;codecs=opus";
  }
  constructor(input) {
    assert.equal(input, stream);
    this.mimeType = "audio/webm";
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable({ data: new Blob(["encoded speech"], { type: this.mimeType }) });
    this.onstop();
  }
};
async function finish(input) {
  const stop = new AbortController();
  const pending = recordUtterance(undefined, undefined, stop.signal, input);
  await new Promise((resolve) => setTimeout(resolve, 300));
  stop.abort();
  return pending;
}
assert((await finish()).size > 0);
assert.deepEqual(acquired, [{ audio: { echoCancellation: true, noiseSuppression: true } }]);
assert.equal(stopped, 1);
assert.equal(closed, 1);
assert((await finish(stream)).size > 0);
assert.equal(acquired.length, 1, "Reuses the live recording microphone");
assert.equal(stopped, 1, "Finishing a question must not stop the day recording microphone");
assert.equal(closed, 2);
const abort = new AbortController();
const pending = recordUtterance(undefined, abort.signal);
await new Promise((resolve) => setTimeout(resolve, 30));
abort.abort();
assert.equal(await pending, null);
assert.equal(stopped, 2);
assert.equal(closed, 3);
navigator.mediaDevices.getUserMedia = async () => {
  throw new Error("permission denied");
};
await assert.rejects(recordUtterance(), /permission denied/);
assert.equal(closed, 4);
// Permission cancellation settles immediately and stops a late-granted mic.
let grant;
navigator.mediaDevices.getUserMedia = () =>
  new Promise((resolve) => {
    grant = resolve;
  });
const waiting = new AbortController();
const waitingClip = recordUtterance(undefined, waiting.signal);
waiting.abort();
assert.equal(await waitingClip, null);
grant(stream);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(stopped, 3);
const finishWaiting = new AbortController();
const secondTap = recordUtterance(undefined, undefined, finishWaiting.signal);
finishWaiting.abort();
assert.equal(await secondTap, null);
grant(stream);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(stopped, 4);
// The mic permission request must not wait for a suspended AudioContext resume.
const RunningAudioContext = globalThis.AudioContext;
globalThis.AudioContext = class extends RunningAudioContext {
  resume() {
    return new Promise(() => {});
  }
};
grant = undefined;
const permissionFirst = new AbortController();
const neverResumed = recordUtterance(undefined, permissionFirst.signal);
assert(grant);
permissionFirst.abort();
assert.equal(await neverResumed, null);
globalThis.AudioContext = RunningAudioContext;// A microphone permission wait must show opening, never claim active recording.
let starts = 0;
let release;
navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { release = resolve; });
const finalTap = new AbortController();
const waitsForMedia = recordUtterance(undefined, undefined, finalTap.signal, undefined, () => starts++);
assert.equal(starts, 0, 'Pending permission must not report listening');
release(stream);
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(starts, 1, 'Listening starts after the recorder is running');
finalTap.abort();
assert((await waitsForMedia).size > 0);
const cancelPending = new AbortController();
const cancelledOpening = recordUtterance(undefined, cancelPending.signal, undefined, undefined, () => starts++);
cancelPending.abort();
assert.equal(await cancelledOpening, null);
release(stream);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(starts, 1, 'Cancelling pending permission never reports listening');
// Cancelling audio resume must not wait for the normal three-second deadline.
globalThis.AudioContext = class extends RunningAudioContext {
  resume() { return new Promise(() => {}); }
};
navigator.mediaDevices.getUserMedia = async () => stream;
const stopResume = new AbortController();
const stalledResume = recordUtterance(undefined, stopResume.signal, undefined, undefined, () => starts++);
await new Promise((resolve) => setTimeout(resolve, 0));
stopResume.abort();
let cancellationTimeout;
assert.equal(await Promise.race([
  stalledResume,
  new Promise((resolve) => { cancellationTimeout = setTimeout(() => resolve('still waiting'), 200); }),
]), null, 'Cancellation immediately releases a suspended audio context');
clearTimeout(cancellationTimeout);
assert.equal(starts, 1, 'Cancelled audio resume does not report listening');
globalThis.AudioContext = RunningAudioContext;
console.log('PASS: recording readiness, pending-permission cancellation, immediate audio-resume cancellation');

console.log(
  "PASS: microphone-only request, encoded submission, shared-track preservation, cancellation, permission cleanup, second-tap cancellation, Safari resume ordering",
);
