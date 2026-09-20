#!/usr/bin/env node
// Live service test: synthetic utterances pass through real browser recording,
// Deepgram transcription, actual conversation routing/model and native TTS playback.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const engines = createRequire(import.meta.url)("playwright");
const origin = process.env.REWIND_UI_TEST_URL,
  token = process.env.REWIND_UI_TEST_TOKEN;
assert(new URL(origin).hostname === "127.0.0.1" && token.startsWith("live-test-"));
const out = path.resolve(process.env.REWIND_TEST_ARTIFACTS);
const questions = JSON.parse(await fs.readFile(path.join(out, "questions.json"), "utf8"));
const report = {
  scope:
    "Real Deepgram STT/TTS and model services; actual built phone UI, isolated disposable data. Synthetic audio is injected into browser MediaStreams, native playback events observed. Physical phones and acoustic speakers are not tested.",
  cases: [],
  errors: [],
  console_errors: [],
};
async function api(endpoint, init = {}) {
  const r = await fetch(origin + "/api" + endpoint, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  assert(r.ok, `${endpoint}: ${r.status}`);
  return r.json();
}
async function until(fn, label, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Timed out: " + label);
}
const initial = await api("/status");
report.backend = {
  provider: initial.provider,
  model: initial.model,
  processing_host: initial.processing_host,
  analysis_ready: initial.analysis_ready,
};
report.browser_versions = {};
assert.equal(initial.received, 0);
assert.equal(initial.workers, 0);
assert((await api("/voice/status")).deepgram);
let cookies;
for (const engine of (process.env.UI_TEST_BROWSERS || "chromium,webkit").split(",")) {
  cookies = undefined;
  const browser = await engines[engine].launch({
    headless: true,
    ...(engine === "chromium"
      ? {
          executablePath:
            process.env.REWIND_TEST_CHROME ||
            (process.platform === "darwin"
              ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
              : undefined),
        }
      : {}),
  });
  report.browser_versions[engine] = browser.version();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    const qa = (window.__livePhone = { question: 0, media: [], playback: [], heard: [] });
    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const p = new NativeAudio(...args);
      for (const kind of ["playing", "ended", "error"])
        p.addEventListener(kind, () =>
          qa.playback.push({ kind, duration: p.duration, at: Date.now() }),
        );
      return p;
    };
    window.Audio.prototype = NativeAudio.prototype;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const createSource = AudioCtx.prototype.createBufferSource;
    AudioCtx.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      const start = source.start;
      source.start = function (...args) {
        if (!source.__qaMicrophone) {
          qa.playback.push({ kind: "playing", duration: source.buffer?.duration, at: Date.now() });
          source.addEventListener("ended", () =>
            qa.playback.push({ kind: "ended", duration: source.buffer?.duration, at: Date.now() }),
          );
        }
        return start.apply(source, args);
      };
      return source;
    };
    Object.getPrototypeOf(navigator.mediaDevices).getUserMedia = async (constraints) => {
      qa.media.push(constraints);
      if (constraints.video) throw Error("Orb unexpectedly requested camera");
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const audio = new Ctx();
      const destination = audio.createMediaStreamDestination();
      await audio.resume();
      const response = await fetch("/__test_audio/" + qa.question + ".mp3");
      const decoded = await audio.decodeAudioData(await response.arrayBuffer());
      const source = audio.createBufferSource();
      source.buffer = decoded;
      source.__qaMicrophone = true;
      source.connect(destination);
      source.start(audio.currentTime + 0.8);
      return destination.stream;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push({ engine, error: e.message }));
  page.on("console", (message) => {
    if (message.type() === "error") report.console_errors.push({ engine, message: message.text() });
  });
  const spoken = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/voice/speak") spoken.push(r.postDataJSON().text);
  });
  await page.route("**/__test_audio/*.mp3", async (r) => {
    const i = Number(new URL(r.request().url()).pathname.match(/(\d+)\.mp3$/)[1]);
    await r.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: await fs.readFile(path.join(out, `question-${i}.mp3`)),
    });
  });
  try {
    if (cookies) {
      await context.addCookies(cookies);
      await page.goto(origin + "/phone/");
    } else {
      const link = await api("/pairing", { method: "POST" });
      await page.goto(origin + "/phone/#connect=" + encodeURIComponent(link.ticket));
      await until(() => !new URL(page.url()).hash, "Pairing");
      await until(
        async () => (await page.request.get(origin + "/api/status")).ok(),
        "Cookie session established",
      );
      cookies = (await context.cookies()).filter((c) => c.name === "rewind_session");
    }
    await page.getByRole("button", { name: "Ask by voice", exact: true }).waitFor();
    await page.waitForTimeout(1200);
    for (let i = 0; i < questions.length; i++) {
      const began = Date.now();
      await page.evaluate((i) => (window.__livePhone.question = i), i);
      const turnsBefore = new Set((await api("/conversation/state")).turns.map((t) => t.id));
      const audioBefore = await page.evaluate(
        () =>
          window.__livePhone.playback.filter((e) => e.kind === "ended" && e.duration > 0.5).length,
      );
      await page.getByRole("button", { name: "Ask by voice", exact: true }).tap();
      let turn;
      await until(async () => {
        turn = (await api("/conversation/state")).turns.findLast((t) => !turnsBefore.has(t.id));
        return turn?.status === "completed" && turn.response;
      }, "Actual STT and conversational response");
      assert.equal(turn.kind, "chat");
      assert(
        !/couldn.t find.*(?:day|photo)|trouble replying|not (?:available|connected)/i.test(
          turn.response,
        ),
      );
      if (i === 0) assert.match(turn.response, /Rewind/);
      await page.getByText(turn.response, { exact: true }).first().waitFor();
      await until(
        () =>
          page.evaluate(
            (n) =>
              window.__livePhone.playback.filter((e) => e.kind === "ended" && e.duration > 0.5)
                .length > n,
            audioBefore,
          ),
        "Actual synthesized answer audio ended",
        60000,
      );
      assert(
        spoken.some((s) => s.includes(turn.response.slice(0, Math.min(30, turn.response.length)))),
        "The actual answer text was synthesized",
      );
      await until(
        () => page.getByRole("button", { name: "Ask by voice", exact: true }).isEnabled(),
        "Orb recovers for next turn",
        10000,
      );
      report.cases.push({
        engine,
        question: questions[i],
        transcript: turn.transcript,
        response: turn.response,
        seconds: (Date.now() - began) / 1000,
        passed: true,
      });
      console.log(JSON.stringify(report.cases.at(-1)));
    }
    assert((await page.evaluate(() => window.__livePhone.media)).every((m) => m.audio && !m.video));
    assert.equal((await api("/continuous-recordings")).length, 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({
      path: path.join(out, `${engine}-live-three-turns.png`),
      fullPage: true,
    });
  } catch (error) {
    report.cases.push({
      engine,
      passed: false,
      error: error.stack,
      text: await page.locator("body").innerText(),
    });
    await page.screenshot({ path: path.join(out, `${engine}-failure.png`), fullPage: true });
    console.log(JSON.stringify(report.cases.at(-1)));
  } finally {
    await fs.writeFile(
      path.join(out, `${engine}-playback.json`),
      JSON.stringify(await page.evaluate(() => window.__livePhone), null, 2),
    );
    await context.close();
    await browser.close();
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  }
}
report.unexpected_console_errors = report.console_errors.filter(
  (item) => !/Failed to load resource:.*(?:401|404)/.test(item.message),
);
report.passed =
  report.cases.every((c) => c.passed) &&
  report.errors.length === 0 &&
  report.unexpected_console_errors.length === 0;
await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: report.passed,
    artifacts: out,
    cases: report.cases.length,
    errors: report.errors,
  }),
);
if (!report.passed) process.exitCode = 1;
