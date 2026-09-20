// Playback failure/cancellation regression. These are API doubles, not acoustic QA.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const web = path.resolve("web");
const folder = (await fs.readdir(path.join(web, "node_modules/.pnpm"))).find((name) =>
  name.startsWith("esbuild@"),
);
const esbuild = require(path.join(web, "node_modules/.pnpm", folder, "node_modules/esbuild"));
const result = await esbuild.build({
  entryPoints: [path.join(web, "lib/server-speech.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { ServerSpeech } = await import(
  "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")
);
globalThis.document = { hidden: false };
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US" },
  configurable: true,
});
const audioPlayers = [];
globalThis.Audio = class {
  constructor() {
    audioPlayers.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {}
};
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};
let active = null,
  nativeCancels = 0,
  nativeCalls = [],
  status = 503;
window.speechSynthesis = {
  resume() {},
  speak(utterance) {
    active = utterance;
    nativeCalls.push(utterance);
  },
  cancel() {
    nativeCancels++;
    active?.onerror?.({ error: "canceled" });
    active = null;
  },
};
globalThis.fetch = async (url) =>
  new Response(url.endsWith("/status") ? JSON.stringify({ deepgram: false }) : "", {
    status: url.endsWith("/status") ? 200 : status,
    headers: { "Content-Type": "application/json" },
  });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const finish = () => {
  const utterance = active;
  assert(utterance);
  utterance.onstart?.();
  utterance.onend?.();
};
const speech = new ServerSpeech();
await tick();
let started = 0;
let played = speech.speak("Hello", () => started++);
assert.equal(started, 0, "Scheduling synthesis is not delivery");
active.onerror({ error: "not-allowed" });
assert.equal(await played, false);
assert.match(speech.error, /browser blocked voice/);
played = speech.speak("Second question", () => started++);
finish();
assert.equal(await played, true);
assert.equal(started, 1);
assert.equal(speech.error, "");
played = speech.speak("Cancelled question");
const stale = active;
speech.cancel();
assert.equal(await played, false);
assert.equal(nativeCancels, 1);
assert.equal(stale.onend, null);
played = speech.speak("After cancel");
finish();
assert.equal(await played, true);
// A server failure falls back to native once, then the next question still works.
speech.enabled = true;
speech.unlock();
assert.match(
  audioPlayers[0].src,
  /^data:audio\/wav;base64,/,
  "Silent unlocking has no revocable Blob URL",
);
assert.equal(active.text, " ");
assert.equal(active.volume, 0, "Remote TTS must prime fallback during the gesture too");
played = speech.speak("Fallback answer");
await tick();
assert.equal(active.text, "Fallback answer");
finish();
assert.equal(await played, true);
// Authentication failure must never leak an answer through the fallback voice.
status = 401;
const before = nativeCalls.length;
assert.equal(await speech.speak("Private answer"), false);
assert.equal(nativeCalls.length, before);
// Silent native priming happens synchronously during unlock, not at response time.
speech.enabled = false;
speech.unlock();
assert.equal(active.text, " ");
assert.equal(active.volume, 0);
played = speech.speak("After priming");
finish();
assert.equal(await played, true);
speech.dispose();
assert.equal(await speech.speak("Disposed"), false);
console.log(
  "PASS: blocked voice recovery, start/end delivery accounting, native cancellation, server fallback, auth suppression, silent gesture priming",
);
