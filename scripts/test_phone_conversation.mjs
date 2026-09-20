#!/usr/bin/env node
// Built phone UI + real isolated API routing/state. Media is synthetic and the
// deterministic tier substitutes STT/TTS network results, never DOM or playback.
// UI_TEST_BROWSERS=chromium,webkit (default) selects browser engines.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const engines = createRequire(import.meta.url)("playwright");
const origin = process.env.REWIND_UI_TEST_URL;
const token = process.env.REWIND_UI_TEST_TOKEN;
assert(origin && new URL(origin).hostname === "127.0.0.1");
assert(token?.startsWith("ui-test-"), "Run with scripts/run_ui_integration.py");
const output = path.resolve("data/ui-integration/phone-conversation-" + Date.now());
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const report = {
  scope:
    "Real built UI and isolated backend; synthetic microphone/camera, deterministic STT and WAV TTS. Native audio playing/ended events are observed. Desktop WebKit mobile emulation is not a physical iPhone.",
  cases: [],
  errors: [],
  console_errors: [],
  requests: [],
  browser_versions: {},
};
const caseFilter = process.env.UI_TEST_FILTER ? new RegExp(process.env.UI_TEST_FILTER, "i") : null;
const browserNames = (process.env.UI_TEST_BROWSERS || "chromium,webkit").split(",");
async function admin(endpoint, init = {}) {
  const response = await fetch(origin + "/api" + endpoint, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  assert(response.ok, `${endpoint}: ${response.status}`);
  return response.json();
}
const status = await admin("/status");
assert.equal(status.provider, "disabled");
assert.equal(status.workers, 0);
assert.equal(status.received, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 22000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw Error(`${label}${last ? ": " + last.message : ""}`);
}
function wave(seconds = 0.3) {
  const samples = Math.floor(16000 * seconds),
    b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(Math.sin((i * 2 * Math.PI * 330) / 16000) * 1200, 44 + i * 2);
  return b;
}
const speechWav = wave();
let cookies;
const respond = (r, status, body) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function setup(browser, engine, label, viewport = { width: 390, height: 844 }, options = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    const qa = (window.__phoneQA = {
      constraints: [],
      streams: [],
      audioContexts: [],
      spoken: [],
      playback: [],
      denyNext: null,
      delayNext: false,
      release: null,
      uploads: [],
      encodedVideo: [],
    });
    try {
      const originalFetch = window.fetch;
      window.fetch = function (input, init) {
        if (String(input).includes("/voice/hear"))
          qa.uploads.push({ bytes: init?.body?.size || 0, type: init?.body?.type });
        return originalFetch.call(this, input, init);
      };
      const NativeAudio = window.Audio;
      window.Audio = function (...args) {
        const player = new NativeAudio(...args);
        for (const kind of ["playing", "ended", "error"])
          player.addEventListener(kind, () =>
            qa.playback.push({ kind, duration: player.duration, at: Date.now() }),
          );
        return player;
      };
      window.Audio.prototype = NativeAudio.prototype;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const createSource = AudioCtx.prototype.createBufferSource;
      AudioCtx.prototype.createBufferSource = function () {
        const source = createSource.call(this);
        const start = source.start;
        source.start = function (...args) {
          qa.playback.push({ kind: "playing", duration: source.buffer?.duration, at: Date.now() });
          source.addEventListener("ended", () =>
            qa.playback.push({ kind: "ended", duration: source.buffer?.duration, at: Date.now() }),
          );
          return start.apply(source, args);
        };
        return source;
      };
      const startRecorder = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = function (...args) {
        if (this.stream.getVideoTracks().length) {
          this.addEventListener("dataavailable", (event) => {
            if (!event.data.size) return;
            const item = { bytes: null };
            qa.encodedVideo.push(item);
            void event.data.arrayBuffer().then((buffer) => {
              item.bytes = Array.from(new Uint8Array(buffer));
            });
          });
        }
        return startRecorder.apply(this, args);
      };
      Object.getPrototypeOf(navigator.mediaDevices).getUserMedia = async (constraints) => {
        qa.constraints.push(JSON.parse(JSON.stringify(constraints)));
        if (qa.denyNext && constraints[qa.denyNext]) {
          qa.denyNext = null;
          throw new DOMException("Permission denied by test", "NotAllowedError");
        }
        const stream = new MediaStream();
        if (constraints.video) {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#315d79";
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = "#fff";
          ctx.font = "40px sans-serif";
          ctx.fillText("Synthetic camera", 90, 240);
          for (const track of canvas.captureStream(10).getVideoTracks()) {
            stream.addTrack(track);
            const timer = setInterval(() => {
              ctx.fillStyle = "#fff";
              ctx.fillRect(10, 10, 4, 4);
            }, 100);
            track.addEventListener("ended", () => clearInterval(timer));
          }
        }
        if (constraints.audio) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const audio = new AudioCtx();
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          const destination = audio.createMediaStreamDestination();
          oscillator.connect(gain);
          gain.connect(destination);
          gain.gain.value = 0;
          oscillator.start();
          await audio.resume();
          stream.addTrack(destination.stream.getAudioTracks()[0]);
          qa.audioContexts.push({ audio, gain });
        }
        qa.streams.push(stream);
        if (qa.delayNext) {
          qa.delayNext = false;
          await new Promise((r) => (qa.release = r));
        }
        return stream;
      };
      qa.tone = async () => {
        for (const { audio, gain } of qa.audioContexts) {
          await audio.resume();
          gain.gain.setValueAtTime(0.15, audio.currentTime);
          gain.gain.setValueAtTime(0, audio.currentTime + 0.7);
        }
      };
    } catch (error) {
      qa.initError = String(error);
    }
  });
  const page = await context.newPage();
  page.__label = label;
  page.setDefaultTimeout(16000);
  page.on("pageerror", (e) => report.errors.push({ engine, label, message: e.message }));
  page.on("console", (message) => {
    if (message.type() === "error")
      report.console_errors.push({ engine, label, message: message.text() });
  });
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      report.requests.push({ engine, label, path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.route("**/api/voice/status", (r) =>
    respond(r, 200, { deepgram: true, tts_model: "synthetic-wave", stt_model: "fixture" }),
  );
  await page.route("**/api/voice/speak", async (r) => {
    const text = r.request().postDataJSON().text;
    await page.evaluate((t) => window.__phoneQA.spoken.push(t), text);
    await r.fulfill({ status: 200, contentType: "audio/wav", body: speechWav });
  });
  if (options.beforeLoad) await options.beforeLoad(page);
  if (cookies) {
    await context.addCookies(cookies);
    await page.goto(origin + "/phone/");
  } else {
    const invitation = await admin("/pairing", { method: "POST" });
    await page.goto(origin + "/phone/#connect=" + encodeURIComponent(invitation.ticket));
    await until(() => !new URL(page.url()).hash, "Pairing redeemed");
    await until(
      async () => (await page.request.get(origin + "/api/status")).ok(),
      "Cookie session established",
    );
    cookies = (await context.cookies()).filter((c) => c.name === "rewind_session");
    assert(cookies[0]?.httpOnly);
  }
  await page.getByRole("button", { name: "Ask by voice", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__phoneQA.initError),
    undefined,
    "Browser fixture initializes fully",
  );
  if (options.waitHistory !== false)
    await until(
      () =>
        report.requests.some(
          (r) => r.engine === engine && r.label === label && r.path === "/api/conversation/state",
        ),
      "Conversation history initialized",
    );
  await page.waitForTimeout(300);
  return { page, context };
}
async function closeScenario(page, context) {
  await fs.writeFile(
    path.join(
      output,
      `${page.__label}-${page.context().browser().browserType().name()}-state.json`,
    ),
    JSON.stringify(
      {
        text: await page.locator("body").innerText(),
        media: await page.evaluate(() => window.__phoneQA.constraints),
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: path.join(
      output,
      `${page.__label}-${page.context().browser().browserType().name()}-state.png`,
    ),
    fullPage: true,
  });
  await context.close();
}
async function noOverflow(page) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "No horizontal overflow",
  );
}
async function test(engine, name, fn) {
  if (caseFilter && !caseFilter.test(name)) return;
  const start = Date.now();
  try {
    const details = await fn();
    report.cases.push({
      engine,
      name,
      passed: true,
      seconds: (Date.now() - start) / 1000,
      details,
    });
  } catch (error) {
    report.cases.push({
      engine,
      name,
      passed: false,
      seconds: (Date.now() - start) / 1000,
      error: error.stack,
    });
  }
  console.log(JSON.stringify(report.cases.at(-1)));
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
for (const engine of browserNames) {
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
  try {
    await test(
      engine,
      "three consecutive orb turns answer conversationally and complete native audio playback",
      async () => {
        const { page, context } = await setup(browser, engine, "repeated-voice");
        try {
          const videosBefore = (await admin("/continuous-recordings")).length;
          const questions = ["Hi, can you hear me? What's your name?", "How are you?", "Thanks"];
          const answers = [];
          let heard = 0;
          await page.route("**/api/voice/hear?wake=false", async (r) => {
            assert.equal(r.request().method(), "POST");
            const clip = await page.evaluate(() => window.__phoneQA.uploads.at(-1));
            assert(clip.bytes > 100, "Actual encoded mic bytes submitted");
            const text = questions[heard++];
            assert(text, "Only the requested three turns are submitted");
            return respond(r, 200, { transcript: text, question: text, directed: true });
          });
          for (const question of questions) {
            const turnsBefore = new Set(
              (await admin("/conversation/state")).turns.map((t) => t.id),
            );
            const microphoneBefore = await page.evaluate(
              () => window.__phoneQA.audioContexts.length,
            );
            const audioBefore = await page.evaluate(
              () =>
                window.__phoneQA.playback.filter((e) => e.kind === "ended" && e.duration > 0.1)
                  .length,
            );
            await page.getByRole("button", { name: "Ask by voice", exact: true }).tap();
            await page
              .getByRole("button", { name: "Finish and send question", exact: true })
              .waitFor();
            await until(
              () =>
                page.evaluate((n) => window.__phoneQA.audioContexts.length > n, microphoneBefore),
              "New microphone stream exists",
            );
            await page.evaluate(() => window.__phoneQA.tone());
            await page.waitForTimeout(850);
            await page.getByRole("button", { name: "Finish and send question", exact: true }).tap();
            let turn;
            await until(async () => {
              turn = (await admin("/conversation/state")).turns.findLast(
                (t) => t.transcript === question && !turnsBefore.has(t.id),
              );
              return turn?.status === "completed" && turn.response;
            }, "Actual conversation router completes " + question);
            assert.equal(turn.kind, "chat");
            assert(
              !/couldn.t find.*(?:day|photo)|picture.*evidence|recording.*needed/i.test(
                turn.response,
              ),
            );
            if (question.includes("name")) assert.match(turn.response, /Rewind/);
            await page.getByText(turn.response, { exact: true }).waitFor();
            await until(
              () =>
                page.evaluate(
                  (before) =>
                    window.__phoneQA.playback.filter((e) => e.kind === "ended" && e.duration > 0.1)
                      .length > before,
                  audioBefore,
                ),
              "Native answer audio ends",
            );
            await until(
              () => page.getByRole("button", { name: "Ask by voice", exact: true }).isEnabled(),
              "Orb ready for next question",
            );
            answers.push({ question, response: turn.response });
          }
          assert.equal(heard, 3);
          const constraints = await page.evaluate(() => window.__phoneQA.constraints);
          assert.equal(constraints.length, 3);
          assert(
            constraints.every((c) => c.audio && !c.video),
            "Orb never requests camera",
          );
          assert.equal(
            (await admin("/continuous-recordings")).length,
            videosBefore,
            "Orb never records video",
          );
          await noOverflow(page);
          await page.screenshot({
            path: path.join(output, `${engine}-three-turns.png`),
            fullPage: true,
          });
          return answers;
        } finally {
          await closeScenario(page, context);
        }
      },
    );
    await test(engine, "typed conversation works repeatedly through the real backend", async () => {
      const { page, context } = await setup(browser, engine, "repeated-text");
      try {
        for (const question of ["Hello", "What can you do?"]) {
          const turnsBefore = new Set((await admin("/conversation/state")).turns.map((t) => t.id));
          await page
            .getByRole("textbox", { name: "Type a question or request", exact: true })
            .fill(question);
          await page.getByRole("button", { name: "Send question", exact: true }).tap();
          let turn;
          await until(async () => {
            turn = (await admin("/conversation/state")).turns.findLast(
              (t) => t.transcript === question && !turnsBefore.has(t.id),
            );
            return turn?.status === "completed" && turn.response;
          }, "Typed conversation completes");
          await page.getByText(turn.response, { exact: true }).first().waitFor();
        }
        await noOverflow(page);
      } finally {
        await closeScenario(page, context);
      }
    });
    await test(
      engine,
      "a fast answer before POST acknowledgement is displayed and spoken once",
      async () => {
        let releaseHistory, releaseAck, submittedId;
        const { page, context } = await setup(browser, engine, "fast-answer", undefined, {
          waitHistory: false,
          beforeLoad: async (page) => {
            let first = true;
            await page.route("**/api/conversation/state", async (route) => {
              if (first) {
                first = false;
                await new Promise((resolve) => (releaseHistory = resolve));
              }
              await route.continue();
            });
            await page.route("**/api/conversation/text", async (route) => {
              submittedId = route.request().postDataJSON().id;
              const response = await route.fetch();
              await new Promise((resolve) => (releaseAck = resolve));
              await route.fulfill({ response });
            });
          },
        });
        try {
          const spokenBefore = await page.evaluate(() => window.__phoneQA.spoken.length);
          await page
            .getByRole("textbox", { name: "Type a question or request", exact: true })
            .fill("Hi there");
          await page.getByRole("button", { name: "Send question", exact: true }).tap();
          await until(
            () => releaseAck && releaseHistory,
            "POST acknowledged by backend and initial history is pending",
          );
          let turn;
          await until(async () => {
            turn = (await admin("/conversation/state")).turns.find((t) => t.id === submittedId);
            return turn?.status === "completed";
          }, "Fast backend answer complete");
          releaseHistory();
          await until(
            () =>
              report.requests.some(
                (r) =>
                  r.engine === engine &&
                  r.label === "fast-answer" &&
                  r.path === "/api/conversation/state",
              ),
            "First history response arrives before delayed POST acknowledgement",
          );
          releaseAck();
          await page.getByText(turn.response, { exact: true }).first().waitFor();
          await until(
            () =>
              page.evaluate(
                ({ text, before }) => window.__phoneQA.spoken.slice(before).includes(text),
                { text: turn.response, before: spokenBefore },
              ),
            "Own fast answer is spoken",
          );
          await page.waitForTimeout(2700);
          assert.equal(
            (await page.evaluate(() => window.__phoneQA.spoken))
              .slice(spokenBefore)
              .filter((t) => t === turn.response).length,
            1,
            "Fast answer speaks exactly once",
          );
        } finally {
          releaseHistory?.();
          releaseAck?.();
          await closeScenario(page, context);
        }
      },
    );
    await test(
      engine,
      "camera takes a JPEG; Record retains video; both work after an orb interaction",
      async () => {
        const { page, context } = await setup(browser, engine, "camera-record");
        try {
          await page.evaluate(() => (window.__phoneQA.denyNext = "audio"));
          await page.getByRole("button", { name: "Ask by voice", exact: true }).tap();
          const denied = page
            .getByRole("alert")
            .filter({ hasText: /microphone|permission|denied/i })
            .first();
          await denied.waitFor();
          await page.waitForTimeout(4500);
          assert(await denied.isVisible(), "Microphone error survives routine status polling");
          const before = (await admin("/status")).received;
          await page.getByRole("button", { name: "Camera", exact: true }).tap();
          await until(
            async () => (await admin("/status")).received > before,
            "Camera JPEG uploaded",
          );
          assert.equal(await page.getByRole("button", { name: "Scan", exact: true }).count(), 0);
          const photos = await admin("/recordings?limit=60");
          assert(photos.some((r) => r.kind === "frame"));
          const originalsBefore = new Set((await admin("/continuous-recordings")).map((r) => r.id));
          await page.getByRole("button", { name: "Record", exact: true }).tap();
          await page.getByRole("button", { name: "Stop recording", exact: true }).waitFor();
          await page.waitForTimeout(1200);
          await page.getByRole("button", { name: "Stop recording", exact: true }).tap();
          let recording;
          await until(async () => {
            recording = (await admin("/continuous-recordings")).find(
              (r) => !originalsBefore.has(r.id) && r.complete && r.bytes > 0,
            );
            return !!recording;
          }, "Original video finalized");
          assert(recording.original_url);
          const original = await page.request.get(origin + recording.original_url);
          assert(original.ok());
          const originalBytes = await original.body();
          assert(originalBytes.length > 100);
          await until(
            () =>
              page.evaluate(
                () =>
                  window.__phoneQA.encodedVideo.length > 0 &&
                  window.__phoneQA.encodedVideo.every((part) => part.bytes),
              ),
            "Encoded original chunks observed",
          );
          const captured = await page.evaluate(() =>
            window.__phoneQA.encodedVideo.map((part) => part.bytes),
          );
          assert.deepEqual(
            originalBytes,
            Buffer.concat(captured.map((part) => Buffer.from(part))),
            "Stored original bytes equal actual MediaRecorder output byte-for-byte",
          );
          await until(
            () =>
              page.evaluate(() =>
                window.__phoneQA.streams.every((s) =>
                  s.getTracks().every((t) => t.readyState === "ended"),
                ),
              ),
            "All tracks stop",
          );
          const voice = await page.evaluate(() => window.__phoneQA.spoken);
          assert(
            !voice.includes("Voice is on."),
            "Record does not speak an unrelated voice confirmation",
          );
          await noOverflow(page);
          await page.screenshot({
            path: path.join(output, `${engine}-camera-record.png`),
            fullPage: true,
          });
          return { originalBytes: recording.bytes };
        } finally {
          await closeScenario(page, context);
        }
      },
    );
    await test(
      engine,
      "interrupting spoken output with the orb does not replay the old answer",
      async () => {
        const { page, context } = await setup(browser, engine, "interrupt-speech");
        try {
          let oldText;
          await page.route("**/api/voice/speak", async (route) => {
            const text = route.request().postDataJSON().text;
            oldText ??= text;
            await page.evaluate((text) => window.__phoneQA.spoken.push(text), text);
            await route.fulfill({
              status: 200,
              contentType: "audio/wav",
              body: wave(text === oldText ? 6 : 0.3),
            });
          });
          const before = new Set((await admin("/conversation/state")).turns.map((turn) => turn.id));
          await page
            .getByRole("textbox", { name: "Type a question or request", exact: true })
            .fill("Hello");
          await page.getByRole("button", { name: "Send question", exact: true }).tap();
          await until(async () => {
            const turn = (await admin("/conversation/state")).turns.find(
              (turn) => !before.has(turn.id),
            );
            oldText = turn?.response;
            return oldText;
          }, "First answer prepared");
          await until(
            () =>
              page.evaluate(() =>
                window.__phoneQA.playback.some(
                  (event) => event.kind === "playing" && event.duration > 5,
                ),
              ),
            "First answer is actively playing",
          );
          await page.route("**/api/voice/hear?wake=false", (route) =>
            respond(route, 200, {
              transcript: "How are you?",
              question: "How are you?",
              directed: true,
            }),
          );
          const voiceBefore = new Set(
            (await admin("/conversation/state")).turns.map((turn) => turn.id),
          );
          await page.getByRole("button", { name: "Ask by voice", exact: true }).tap();
          await page
            .getByRole("button", { name: "Finish and send question", exact: true })
            .waitFor();
          await until(
            () => page.evaluate(() => window.__phoneQA.audioContexts.length > 0),
            "Interrupting microphone opens",
          );
          await page.evaluate(() => window.__phoneQA.tone());
          await page.waitForTimeout(850);
          await page.getByRole("button", { name: "Finish and send question", exact: true }).tap();
          let reply;
          await until(async () => {
            const turn = (await admin("/conversation/state")).turns.find(
              (turn) => !voiceBefore.has(turn.id),
            );
            reply = turn?.response;
            return turn?.status === "completed" && reply;
          }, "New answer completes");
          await until(
            () => page.evaluate((text) => window.__phoneQA.spoken.includes(text), reply),
            "New answer is spoken",
          );
          await page.waitForTimeout(3000);
          assert.equal(
            (await page.evaluate(() => window.__phoneQA.spoken)).filter((text) => text === oldText)
              .length,
            1,
            "Interrupted old output is never automatically replayed",
          );
        } finally {
          await closeScenario(page, context);
        }
      },
    );
    await test(engine, "camera denial is visible and the next attempt recovers", async () => {
      const { page, context } = await setup(browser, engine, "camera-permission");
      try {
        await page.evaluate(() => (window.__phoneQA.denyNext = "video"));
        await page.getByRole("button", { name: "Camera", exact: true }).tap();
        await page
          .getByRole("alert")
          .filter({ hasText: /camera|permission|denied/i })
          .first()
          .waitFor();
        const before = (await admin("/status")).received;
        await page.getByRole("button", { name: "Camera", exact: true }).tap();
        await until(
          async () => (await admin("/status")).received > before,
          "Camera retry saves photo",
        );
        await noOverflow(page);
      } finally {
        await closeScenario(page, context);
      }
    });
    await test(
      engine,
      "recording can be cancelled while permission is pending and late streams stop",
      async () => {
        const { page, context } = await setup(browser, engine, "late-permission");
        try {
          await page.evaluate(() => (window.__phoneQA.delayNext = true));
          await page.getByRole("button", { name: "Record", exact: true }).tap();
          await until(
            () => page.evaluate(() => typeof window.__phoneQA.release === "function"),
            "Media request pending",
          );
          await page.getByRole("button", { name: "Cancel opening camera", exact: true }).tap();
          await page.evaluate(() => window.__phoneQA.release());
          await until(
            () =>
              page.evaluate(() =>
                window.__phoneQA.streams.every((s) =>
                  s.getTracks().every((t) => t.readyState === "ended"),
                ),
              ),
            "Cancelled stream tracks end",
          );
          assert.equal(
            await page.getByRole("button", { name: "Stop recording", exact: true }).count(),
            0,
          );
        } finally {
          await closeScenario(page, context);
        }
      },
    );
    await test(engine, "phone layout fits small and large mobile widths", async () => {
      const { page, context } = await setup(browser, engine, "layouts");
      try {
        for (const viewport of [
          { width: 320, height: 844 },
          { width: 375, height: 844 },
          { width: 390, height: 844 },
          { width: 430, height: 844 },
          { width: 768, height: 844 },
          { width: 844, height: 390 },
        ]) {
          const { width, height } = viewport;
          await page.setViewportSize(viewport);
          await noOverflow(page);
          for (const name of ["Ask by voice", "Camera", "Record"]) {
            const control = page.getByRole("button", { name, exact: true });
            await control.scrollIntoViewIfNeeded();
            const box = await control.boundingBox();
            assert(box && box.width >= 40 && box.height >= 40, `${name}: touch target >=40px`);
          }
          await page.screenshot({
            path: path.join(output, `${engine}-phone-${width}x${height}.png`),
            fullPage: true,
          });
        }
      } finally {
        await closeScenario(page, context);
      }
    });
  } finally {
    await browser.close();
  }
}
report.unexpected_console_errors = report.console_errors.filter(
  (item) => !/Failed to load resource:.*(?:401|404|503)/.test(item.message),
);
report.passed =
  report.cases.every((c) => c.passed) &&
  report.errors.length === 0 &&
  report.unexpected_console_errors.length === 0;
report.finished_at = new Date().toISOString();
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: report.passed,
    cases: report.cases.length,
    errors: report.errors,
    artifacts: output,
  }),
);
if (!report.passed) process.exitCode = 1;
