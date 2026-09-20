#!/usr/bin/env node
// Browser integration against an explicitly isolated, empty, local backend.
// Real APIs: pairing, sessions, upload, continuous originals, conversation ingress.
// Deterministic network fixtures: unavailable uploads, slow/auth polls, review states.
// Does not launch a server, call an inference provider, or read production env files.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = new URL(process.env.REWIND_UI_TEST_URL || "http://127.0.0.1:0");
const token = process.env.REWIND_UI_TEST_TOKEN || "";
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Only loopback fixture servers are allowed");
assert(base.port && base.port !== "0", "Set REWIND_UI_TEST_URL to the isolated fixture server");
assert(token.startsWith("ui-test-"), "Use a fresh test-only token beginning ui-test-");
const origin = base.origin;
const artifacts = path.join(root, "data/ui-integration", `browser-${Date.now()}`);
await fs.mkdir(artifacts, { recursive: true, mode: 0o700 });
const report = {
  origin, started_at: new Date().toISOString(),
  scope: "Isolated real backend and merged browser UI; synthetic camera/audio. No production data or inference.",
  cases: [], javascript_errors: [], console_errors: [], requests: [],
};
const headers = { Authorization: `Bearer ${token}` };
async function admin(endpoint, init = {}) {
  const response = await fetch(origin + "/api" + endpoint, { ...init, headers: { ...headers, ...init.headers } });
  assert(response.ok, `Fixture API ${endpoint}: ${response.status}`);
  return response.json();
}
// An accidental production URL/token must fail before screenshots or mutation.
const initial = await admin("/status");
assert.equal(initial.received, 0, "Fixture must begin with zero personal media");
assert.deepEqual(await admin("/continuous-recordings"), [], "Fixture must begin with no original videos");
assert.equal(initial.provider, "disabled", "Fixture must disable live inference");
assert.equal(initial.workers, 0, "Fixture must not process uploaded fixture media");

const browser = await chromium.launch({
  executablePath: process.env.REWIND_TEST_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const contexts = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ""}`);
}
async function newPage(label, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, permissions: ["camera", "microphone"], reducedMotion: "reduce" });
  contexts.push(context);
  await context.addInitScript(() => {
    const qa = window.__uiQA = { streams: [], audio: [], spoken: [], delayMedia: false, releaseMedia: null };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (qa.delayMedia) await new Promise((resolve) => { qa.releaseMedia = resolve; });
      const stream = constraints.video ? await original({ video: constraints.video, audio: false }) : new MediaStream();
      if (constraints.audio) {
        const audio = new AudioContext();
        const destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        gain.gain.value = 0; oscillator.frequency.value = 440;
        oscillator.connect(gain); gain.connect(destination); oscillator.start();
        await audio.resume();
        stream.addTrack(destination.stream.getAudioTracks()[0]);
        qa.audio.push({ audio, gain });
      }
      qa.streams.push(stream);
      return stream;
    };
    qa.tone = async () => {
      for (const { audio, gain } of qa.audio) {
        await audio.resume(); gain.gain.setValueAtTime(0.12, audio.currentTime);
        gain.gain.setValueAtTime(0, audio.currentTime + 0.65);
      }
    };
    // TTS is inspected without playing sound or injecting it back into the mic.
    if (window.speechSynthesis) {
      speechSynthesis.speak = (utterance) => {
        qa.spoken.push(utterance.text);
        utterance.onstart?.(new Event("start"));
        setTimeout(() => utterance.onend?.(new Event("end")), 25);
      };
      speechSynthesis.cancel = () => {};
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => report.javascript_errors.push({ label, error: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") report.console_errors.push({ label, text: message.text() });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) report.requests.push({ label, path: url.pathname, method: response.request().method(), status: response.status() });
  });
  return page;
}
let pairedCookies;
async function pair(page, route = "/phone/", freshInvitation = false) {
  // New contexts keep media queues isolated. Reuse one real HttpOnly session
  // after testing the three invitation routes, rather than defeating the
  // backend's per-peer pairing rate limit during unrelated UI scenarios.
  if (pairedCookies && !freshInvitation) {
    await page.context().addCookies(pairedCookies);
    await page.goto(origin + route);
    assert((await page.request.get(origin + "/api/status")).ok(), "Reused real cookie session remains authenticated");
    await page.waitForFunction(() => !document.querySelector("#login-title") && !!document.querySelector("main"));
    return null;
  }
  const invitation = await admin("/pairing", { method: "POST" });
  await page.goto(origin + route + "#connect=" + encodeURIComponent(invitation.ticket));
  await until(async () => !new URL(page.url()).hash, `${route}: sign-in ticket removed from URL`);
  await until(async () => (await page.request.get(origin + "/api/status")).ok(), `${route}: real cookie session established`);
  await page.waitForFunction(() => !document.querySelector("#login-title") && !!document.querySelector("main"));
  const session = (await page.context().cookies()).find((cookie) => cookie.name === "rewind_session");
  assert(session?.httpOnly, "The admin secret must not be exposed in browser-readable session cookies");
  pairedCookies = [session];
  return invitation;
}
async function queue(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("rewind-phone-recordings", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("chunks")) { db.close(); resolve([]); return; }
      const tx = db.transaction("chunks"), read = tx.objectStore("chunks").getAll();
      tx.oncomplete = () => { resolve(read.result.map((item) => ({ id: item.id, kind: item.kind, bytes: item.blob?.size ?? item.bytes?.byteLength }))); db.close(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}
async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    offenders: [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && r.right > innerWidth + 2 && getComputedStyle(el).position !== "fixed";
    }).slice(0, 8).map((el) => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })),
  }));
  assert(dimensions.document <= dimensions.width + 2 && dimensions.body <= dimensions.width + 2, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
}
async function noInventedData(page) {
  const text = await page.locator("body").innerText();
  const restoredWidgets = await page.locator('.mode-rose').count() > 0;
  if (!restoredWidgets) assert(!/\bRose\b|\bElena\b|\b68\s*bpm\b|\b98\s*%\b|\b10,240\b/i.test(text), "Non-demo surface rendered invented data");
  else assert.equal(await page.locator('[data-card="notes"] .postcard').count(),0,'Fixed mail is absent until an actual Scan');
  assert.equal(await page.locator('img[src*="unsplash"],img[src*="pexels"],img[src*="demo-"]').count(), 0, "No stock/demo evidence on empty workspace");
}
async function test(name, fn) {
  const began = Date.now();
  const contextStart = contexts.length;
  try { const details = await fn(); report.cases.push({ name, passed: true, seconds: (Date.now() - began) / 1000, details }); }
  catch (error) { report.cases.push({ name, passed: false, seconds: (Date.now() - began) / 1000, error: error.stack }); }
  finally { await Promise.allSettled(contexts.slice(contextStart).map((context) => context.close())); }
  console.log(JSON.stringify(report.cases.at(-1)));
  await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
}
const respond = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
let source;
try {
  await test("real pairing links at root, workspace and phone; one-use session", async () => {
    for (const route of ["/", "/workspace/", "/phone/"]) {
      const page = await newPage("pair-" + route, route === "/phone/" ? undefined : { width: 1440, height: 1000 });
      const ticket = await pair(page, route, true);
      await page.getByRole("heading").first().waitFor();
      if (route === "/") {
        await page.getByText("iPhone", { exact: true }).waitFor();
        await page.getByText("On the way", { exact: true }).waitFor();
      }
      await noInventedData(page); await noOverflow(page);
      const repeated = await fetch(origin + "/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: ticket.ticket, remember: false }) });
      assert(!repeated.ok, "Pairing invitation must work once only");
      await page.screenshot({ path: path.join(artifacts, `empty-${route.replaceAll("/", "") || "root"}.png`), fullPage: true });
      if (route === "/phone/") {
        await page.setViewportSize({ width: 320, height: 740 });
        await noOverflow(page);
        await page.screenshot({ path: path.join(artifacts, "empty-phone-320.png"), fullPage: true });
      }
      await page.close();
    }
  });
  await test("desktop and narrow viewport empty workspace; offline has no invented fallback", async () => {
    for (const route of ["/", "/workspace/"]) {
      const page = await newPage("empty-" + route, { width: 1440, height: 1000 });
      await pair(page, route);
      await page.getByRole("heading").first().waitFor();
      await noInventedData(page); await noOverflow(page);
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
      await page.route("**/api/**", (r) => respond(r, 503, { detail: "Isolated offline fixture" }));
      await page.reload();
      await page.getByRole("heading", {
        name: route === "/" ? "Your workspace is unavailable." : "Unable to reach your workspace",
        exact: true,
      }).waitFor();
      await noInventedData(page); await noOverflow(page);
      await page.screenshot({ path: path.join(artifacts, `offline-${route.replaceAll("/", "") || "root"}.png`), fullPage: true });
      await page.close();
    }
  });
  await test("record/stop retains real original video and automatic voice upload", async () => {
    const page = await newPage("capture"); await pair(page);
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.getByRole("button", { name: "Stop recording", exact: true }).waitFor();
    await page.waitForFunction(() => window.__uiQA.audio.length > 0);
    await page.waitForTimeout(1200); await page.evaluate(() => window.__uiQA.tone());
    await until(() => report.requests.some((r) => r.label === "capture" && r.path === "/api/conversation/audio" && r.method === "POST" && r.status === 200), "Record must automatically segment and upload speech audio", 16000);
    await page.getByRole("button", { name: "Stop recording", exact: true }).click();
    await page.getByRole("button", { name: "Record", exact: true }).waitFor();
    const recording = await until(async () => (await admin("/continuous-recordings")).find((r) => r.complete && r.bytes > 0 && r.original_url), "Stopped original must finish durably", 25000);
    const original = await page.request.get(origin + recording.original_url);
    assert(original.ok()); assert((await original.body()).length > 1000, "Real MediaRecorder original bytes retained");
    const unauthorized = await fetch(origin + recording.original_url);
    assert.equal(unauthorized.status, 401, "Original video stays authenticated");
    await page.waitForFunction(() => window.__uiQA.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
    const media = await admin("/recordings?limit=60");
    source = media.find((r) => r.kind === "frame"); assert(source, "Lightweight frames accompany continuous original");
    await noOverflow(page); await page.screenshot({ path: path.join(artifacts, "recording-stopped.png"), fullPage: true });
    for (const name of ["Your connections", "Your computer"]) {
      assert.equal(await page.getByRole("button", {name, exact:true}).count(),0);
    }
    await page.close();
    return { bytes: recording.bytes, chunks: recording.received_chunks, speechUpload: true };
  });
  await test("Camera saves actual camera JPEG; offline queue survives and retries", async () => {
    const page = await newPage("scanner"); await pair(page);
    const before = (await admin("/status")).received;
    await page.route("**/api/ingest/frame", (r) => respond(r, 503, { detail: "Test upload unavailable" }));
    await page.getByRole("button", { name: "Camera", exact: true }).click();
    await until(async () => (await queue(page)).some((c) => c.kind === "frame" && c.bytes > 1000), "Real scan must remain in durable retry queue");
    await page.getByText(/waiting|queued|retry|interrupted|offline/i).first().waitFor();
    assert.equal((await admin("/status")).received, before, "Failed upload cannot increment backend received count");
    assert(!/photo sent|scan sent|sent to your memory|upload complete/i.test(await page.locator("body").innerText()), "Offline scan cannot claim successful delivery");
    await page.screenshot({ path: path.join(artifacts, "scanner-offline.png"), fullPage: true });
    await page.unroute("**/api/ingest/frame");
    await until(async () => (await admin("/status")).received > before, "Queued scanner original retries to actual backend", 25000);
    await until(async () => !(await queue(page)).some((c) => c.kind === "frame"), "Successful scanner upload drains its queue");
    const close = page.getByRole("button", { name: "Close camera", exact: true });
    if (await close.count()) await close.click();
    await page.close();
  });
  await test("cleared offline uploads are discarded and cannot return after reload", async () => {
    const page = await newPage("cleared-queue"); await pair(page);
    await page.route("**/api/ingest/frame", r => respond(r, 503, {detail:"Test offline"}));
    await page.getByRole("button", {name:"Camera",exact:true}).click();
    await until(async()=> (await queue(page)).length>0, "Offline scan is durable");
    await page.getByRole("button", {name:"Close camera",exact:true}).click();
    await page.unroute("**/api/ingest/frame");
    await page.route("**/api/ingest/frame", r => respond(r, 410, {detail:"This recording was cleared from history."}));
    await until(async()=> (await queue(page)).length===0, "Cleared items drain without counting as saved", 25000);
    await page.reload();
    await page.getByRole("button", {name:"Record",exact:true}).waitFor();
    assert.equal((await queue(page)).length,0);
    await page.close();
  });
  await test("late camera permission after hiding or cancelling cannot begin capture", async () => {
    for (const cancellation of ["hidden", "cancel"]) {
      const label = `late-permission-${cancellation}`;
      const page = await newPage(label); await pair(page);
      await page.evaluate(() => { window.__uiQA.delayMedia = true; });
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await page.waitForFunction(() => typeof window.__uiQA.releaseMedia === "function");
      if (cancellation === "hidden") {
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      } else {
        await page.getByRole("button", { name: "Cancel opening camera", exact: true }).click();
      }
      await page.evaluate(() => window.__uiQA.releaseMedia());
      await page.waitForFunction(() => window.__uiQA.streams.length > 0 && window.__uiQA.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
      assert.equal(await page.getByRole("button", { name: "Stop recording", exact: true }).count(), 0);
      assert(!report.requests.some((r) => r.label === label && r.method === "POST" && /ingest|continuous-recordings|conversation\/audio/.test(r.path)), "Cancelled late permission must never upload");
      await page.close();
    }
  });
  await test("workspace computer deep link stays disabled while Notch is disconnected", async () => {
    const page = await newPage("computer", { width: 1440, height: 1000 });
    await pair(page, "/workspace/"); await page.goto(origin + "/workspace/#computer");
    const command = page.getByRole("textbox", { name: "Command for your computer", exact: true });
    await command.fill("Fixture request that must not reach a disconnected computer");
    assert(await page.getByRole("button", { name: "Send to Notch", exact: true }).isDisabled());
    assert(!report.requests.some((r) => r.label === "computer" && r.path === "/api/computer/command"));
    await noOverflow(page); await page.close();
  });
  await test("phone pending answer updates to checked evidence; draft is not spoken", async () => {
    assert(source, "Record fixture must produce a real cited frame first");
    const page = await newPage("review-transition"); await pair(page);
    const question = "UI fixture: what does this original show?";
    const evidence = { ...source, summary: "Fixture camera original" };
    const answer = { id: "66666666-6666-4666-8666-666666666666", question, answer: "UNVERIFIED_FIXTURE_DRAFT", created_at: Date.now() / 1000, mode: "checking", grounded: false, evidence: [evidence], verification: { status: "pending", receipt: {} } };
    let submitted = false, verified = false;
    await page.route("**/api/answers", (r) => respond(r, 200, submitted ? [{ ...answer, ...(verified ? { answer: "CHECKED_FIXTURE_RESULT", mode: "verified", grounded: true, verification: { status: "complete", receipt: { claims_reviewed: true, answer_complete: true, reviews: [{ model: "Fixture reviewer", seconds: 0.01, result: { reason: "Controlled browser-state fixture, not an actual model review." } }] } } } : {}) }] : []));
    await page.route("**/api/conversation/state", (r) => respond(r, 200, { status: submitted ? (verified ? "completed" : "checking") : "listening", turns: submitted ? [{ id: "fixture-turn", transcript: question, response: verified ? "CHECKED_FIXTURE_RESULT" : "", response_revision: verified ? 2 : 1, status: verified ? "completed" : "checking", kind: "recall", answer_id: answer.id, created_at: answer.created_at }] : [] }));
    await page.route("**/api/conversation/text", (r) => { assert.equal(r.request().postDataJSON().text, question); submitted = true; return respond(r, 200, { id: "fixture-turn", status: "queued" }); });
    await page.getByRole("button", { name: "Test voice", exact: true }).click();
    await page.getByRole("textbox", { name: "Type a question or request", exact: true }).fill(question);
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await page.getByText("UNVERIFIED_FIXTURE_DRAFT", { exact: true }).waitFor();
    assert(await page.getByRole("button", { name: "Read answer aloud", exact: true }).isDisabled());
    assert(!(await page.evaluate(() => window.__uiQA.spoken)).some((s) => s.includes("UNVERIFIED_FIXTURE_DRAFT")));
    verified = true;
    await page.getByText("CHECKED_FIXTURE_RESULT", { exact: true }).first().waitFor();
    await page.getByText(/Checked against sources|Sources checked/).first().waitFor();
    assert(!(await page.getByRole("button", { name: "Read answer aloud", exact: true }).isDisabled()));
    await until(async () => (await page.evaluate(() => window.__uiQA.spoken)).includes("CHECKED_FIXTURE_RESULT"), "Completed checked response is automatically spoken");
    await page.waitForTimeout(2800);
    assert.equal((await page.evaluate(() => window.__uiQA.spoken)).filter((s) => s === "CHECKED_FIXTURE_RESULT").length, 1, "Polls must not repeat the checked answer");
    await page.getByText("Fixture camera original", { exact: true }).click();
    const image = page.getByRole("img", { name: "Fixture camera original", exact: true });
    await image.waitFor();
    await until(() => image.evaluate((img) => img.complete && img.naturalWidth > 0), "Cited real original renders through authenticated media API");
    await page.screenshot({ path: path.join(artifacts, "checked-evidence.png"), fullPage: true });
    await page.close();
  });
  await test("dashboard and advanced workspace refresh submitted draft and open real citations", async () => {
    assert(source, "Real source frame is required");
    for (const route of ["/", "/workspace/"]) {
      const page = await newPage("desktop-review-" + route, { width: 1440, height: 1000 });
      await pair(page, route);
      const question = "Fixture question for review-state transition";
      const answer = { id: "77777777-7777-4777-8777-777777777777", question, answer: "DESKTOP_FIXTURE_DRAFT", mode: "checking", grounded: false, evidence: [{ ...source, summary: "Desktop fixture original" }], created_at: Date.now() / 1000 };
      let submitted = false, verified = false;
      const current = () => ({ ...answer, ...(verified ? { answer: "DESKTOP_FIXTURE_CHECKED", mode: "verified", grounded: true, verification: { status: "complete", receipt: { claims_reviewed: true, answer_complete: true, reviews: [] } } } : {}) });
      await page.route("**/api/answers", (r) => respond(r, 200, submitted ? [current()] : []));
      await page.route("**/api/ask", (r) => { assert.equal(r.request().postDataJSON().question, question); submitted = true; return respond(r, 200, current()); });
      if (route === "/") {
        await page.getByRole("textbox", { name: "Ask about your recordings", exact: true }).fill(question);
        await page.getByRole("button", { name: "Send question", exact: true }).click();
      } else {
        await page.getByPlaceholder("Where did I leave…", { exact: true }).fill(question);
        await page.getByRole("button", { name: "Ask memory", exact: true }).click();
      }
      await page.getByText("DESKTOP_FIXTURE_DRAFT", { exact: true }).first().waitFor();
      await page.getByText(/checking.*(evidence|draft)|draft.*checking/i).first().waitFor();
      const read = page.getByRole("button", { name: "Read answer aloud", exact: true });
      if (await read.count()) assert(await read.first().isDisabled());
      verified = true;
      await page.getByText("DESKTOP_FIXTURE_CHECKED", { exact: true }).first().waitFor();
      await page.getByText(/Verified answer|Original evidence reviewed/).first().waitFor();
      if (route === "/") {
        await page.getByRole("button", { name: "Open source 1", exact: true }).first().click();
        await page.getByRole("dialog").waitFor();
        await until(() => page.getByRole("dialog").locator("img").first().evaluate((img) => img.complete && img.naturalWidth > 0), "Desktop source original renders");
      }
      await noOverflow(page); await page.close();
    }
  });
  await test("slow phone, dashboard and workspace polling reject stale 200 after 401", async () => {
    for (const routeName of ["/phone/", "/workspace/", "/"]) {
    const label = "auth-race-" + routeName;
    const page = await newPage(label);
    await pair(page, routeName);
    let count = 0, release, rejectSession, finished = false;
    await page.route("**/api/status", async (route) => {
      count++;
      if (!finished) await new Promise((resolve) => { release = resolve; });
      try { await respond(route, 200, initial); } catch {}
    });
    await page.route("**/api/answers", async (route) => {
      await new Promise((resolve) => { rejectSession = resolve; });
      try { await respond(route, 401, { detail: "Fixture session expired" }); } catch {}
    });
    await page.reload();
    await until(() => !!release && !!rejectSession, "Slow status and expired-answer fixtures are pending");
    await page.waitForTimeout(4400);
    assert.equal(count, 1, "Slow dashboard requests must not overlap");
    // An actual API helper call in the polling group returns401; the earlier
    // status200 arrives later and must not reopen the recorder.
    rejectSession();
    await page.getByRole("heading", { name: "Open your memory.", exact: true }).waitFor();
    finished = true; release();
    await page.waitForTimeout(250);
    const requests = report.requests.filter((r) => r.label === label).length;
    await page.waitForTimeout(4400);
    assert.equal(report.requests.filter((r) => r.label === label).length, requests, "Signed-out page stops all polling");
    assert.equal(await page.getByRole("button", { name: "Record", exact: true }).count(), 0);
    await page.close();
    }
  });
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  report.finished_at = new Date().toISOString();
  report.unexpected_console_errors = report.console_errors.filter((item) => !/^Failed to load resource: the server responded with a status of (401|404|429|503)\b/.test(item.text) && !(item.label === "cleared-queue" && /^Failed to load resource: the server responded with a status of 410\b/.test(item.text)));
  report.passed = report.cases.every((item) => item.passed) && report.javascript_errors.length === 0 && report.unexpected_console_errors.length === 0;
  await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, artifacts, javascript_errors: report.javascript_errors }));
  if (!report.passed) process.exitCode = 1;
}
