#!/usr/bin/env node
// Actual built UI and session handling, deterministic browser speech events.
// This tests playback state/delivery handling, not acoustic speaker output.
// Run through run_ui_integration.py --script scripts/test_voice_playback.mjs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = new URL(process.env.REWIND_UI_TEST_URL || "http://127.0.0.1:0");
const token = process.env.REWIND_UI_TEST_TOKEN || "";
assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
assert(base.port && base.port !== "0");
assert(token.startsWith("ui-test-"));
const origin = base.origin;
const caseFilter = process.env.VOICE_TEST_FILTER ? new RegExp(process.env.VOICE_TEST_FILTER, "i") : null;
const artifacts = path.join(root, "data/ui-integration", `voice-${Date.now()}`);
await fs.mkdir(artifacts, { recursive: true, mode: 0o700 });
const report = {
  scope: "Fresh local disabled backend; real built browser UI/auth; synthetic answer states and controlled speech events. Acoustic output is not tested.",
  case_filter: process.env.VOICE_TEST_FILTER || null,
  cases: [], javascript_errors: [], console_errors: [],
};
async function admin(endpoint, init = {}) {
  const response = await fetch(origin + "/api" + endpoint, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  assert(response.ok, `Fixture API ${endpoint}: ${response.status}`);
  return response.json();
}
const status = await admin("/status");
assert.equal(status.provider, "disabled");
assert.equal(status.workers, 0);
assert.equal(status.received, 0);
const browser = await chromium.launch({
  executablePath: process.env.REWIND_TEST_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
  headless: true,
});
const contexts = [];
let cookies;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 18000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ""}`);
}
const respond = (route, status, value) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
const answer = (text, reviewed = true, id = "55555555-5555-4555-8555-555555555555") => ({
  id, question: "Synthetic playback test question", answer: text, evidence: [],
  created_at: Date.now() / 1000,
  mode: reviewed ? "verified" : "checking", grounded: reviewed,
  verification: { status: reviewed ? "complete" : "pending", receipt: { claims_reviewed: reviewed, answer_complete: reviewed, reviews: [] } },
});
const turn = (candidate, id = "fixture-turn") => ({
  id, transcript: candidate.question, response: candidate.answer, response_revision: 1,
  status: "completed", kind: "recall", answer_id: candidate.id, created_at: candidate.created_at,
});
function fixture() { return { answers: [], turns: [], unauthorized: false, polls: 0, ask: null }; }

async function pageFor(label, model, route = "/phone/") {
  const context = await browser.newContext({ viewport: { width: route === "/" ? 1440 : 390, height: 900 } });
  contexts.push(context);
  await context.addInitScript(() => {
    const qa = window.__voiceQA = {
      mode: "success", calls: [], timeline: [], cancels: 0, active: new Map(), cameraRequests: 0,
    };
    // A pending permission request exercises the Record click without recording
    // or sending any audio/video. The whole isolated context is then disposed.
    navigator.mediaDevices.getUserMedia = () => {
      qa.cameraRequests++;
      qa.timeline.push({ kind: "camera-request" });
      return new Promise(() => {});
    };
    const synthesis = window.speechSynthesis;
    synthesis.getVoices = () => [];
    synthesis.resume = () => {};
    synthesis.pause = () => {};
    function fail(id, error) {
      const active = qa.active.get(id);
      if (!active) return;
      qa.active.delete(id); active.call.error = error;
      active.utterance.onerror?.({ error });
    }
    function start(id) {
      const active = qa.active.get(id);
      if (!active || active.call.started) return;
      active.call.started = true;
      active.utterance.onstart?.(new Event("start"));
    }
    function end(id) {
      const active = qa.active.get(id);
      if (!active) return;
      qa.active.delete(id); active.call.ended = true;
      active.utterance.onend?.(new Event("end"));
    }
    synthesis.speak = (utterance) => {
      const id = qa.calls.length;
      const call = { id, text: utterance.text, mode: qa.mode, started: false, ended: false, error: null, userActivation: navigator.userActivation?.isActive ?? null };
      qa.calls.push(call); qa.timeline.push({ kind: "speech", text: utterance.text });
      qa.active.set(id, { call, utterance });
      if (qa.mode === "not-allowed") setTimeout(() => fail(id, "not-allowed"), 10);
      else if (qa.mode === "success") {
        setTimeout(() => start(id), 10);
        setTimeout(() => end(id), 40);
      } else if (qa.mode === "hold") setTimeout(() => start(id), 10);
      // no-events deliberately calls neither callback: exercise real watchdog.
    };
    synthesis.cancel = () => {
      qa.cancels++;
      for (const id of [...qa.active.keys()]) fail(id, "canceled");
    };
    qa.finish = () => { for (const id of [...qa.active.keys()]) end(id); };
    Object.defineProperty(synthesis, "speaking", { configurable: true, get: () => [...qa.active.values()].some((item) => item.call.started) });
    Object.defineProperty(synthesis, "pending", { configurable: true, get: () => [...qa.active.values()].some((item) => !item.call.started) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(16000);
  page.on("pageerror", (error) => report.javascript_errors.push({ label, message: error.message }));
  page.on("console", (message) => { if (message.type() === "error") report.console_errors.push({ label, message: message.text() }); });
  await page.route("**/api/answers", (r) => respond(r, model.unauthorized ? 401 : 200, model.unauthorized ? { detail: "Fixture session expired" } : model.answers));
  await page.route("**/api/conversation/state", (r) => {
    model.polls++;
    return respond(r, model.unauthorized ? 401 : 200, model.unauthorized ? { detail: "Fixture session expired" } : { status: "listening", turns: model.turns });
  });
  await page.route("**/api/ask", (r) => {
    assert(model.ask, "Every question is an explicit synthetic browser fixture");
    assert.equal(r.request().postDataJSON().question, "Synthetic playback test question");
    model.answers = [model.ask];
    return respond(r, 200, model.ask);
  });
  if (cookies) {
    await context.addCookies(cookies);
    await page.goto(origin + route);
  } else {
    const invitation = await admin("/pairing", { method: "POST" });
    await page.goto(origin + route + "#connect=" + encodeURIComponent(invitation.ticket));
    await until(() => !new URL(page.url()).hash, "Pairing invitation removed from URL");
    await until(async () => (await page.request.get(origin + "/api/status")).ok(), "Actual cookie session established");
    cookies = (await context.cookies()).filter((cookie) => cookie.name === "rewind_session");
    assert(cookies[0]?.httpOnly);
  }
  await page.waitForFunction(() => !!document.querySelector("main") && !document.querySelector("#login-title"));
  if (route === "/phone/") await until(() => model.polls > 0, "Phone starts conversation polling");
  return page;
}
const calls = (page, text) => page.evaluate((text) => window.__voiceQA.calls.filter((call) => call.text === text), text);
const delivered = async (page, text) => (await calls(page, text)).filter((call) => call.started && call.ended && !call.error);
const mode = (page, value) => page.evaluate((value) => { window.__voiceQA.mode = value; }, value);
async function enablePhone(page) {
  await page.getByRole("button", { name: "Spoken answers and reminders", exact: true }).click();
  await until(async () => (await delivered(page, "Voice is on.")).length === 1, "Sound enable confirms successful playback");
}
async function test(name, run) {
  if (caseFilter && !caseFilter.test(name)) return;
  const from = contexts.length, began = Date.now();
  try { const details = await run(); report.cases.push({ name, passed: true, seconds: (Date.now() - began) / 1000, details }); }
  catch (error) { report.cases.push({ name, passed: false, seconds: (Date.now() - began) / 1000, error: error.stack }); }
  finally { await Promise.allSettled(contexts.slice(from).map((context) => context.close())); }
  console.log(JSON.stringify(report.cases.at(-1)));
  await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
}

try {
  await test("phone initial history stays silent; voice and Record warm up from a user gesture", async () => {
    const model = fixture(), historical = answer("HISTORICAL_CHECKED_RESPONSE");
    model.answers = [historical]; model.turns = [turn(historical)];
    const page = await pageFor("history-gesture", model);
    await until(() => model.polls >= 2, "Initial conversation history observed");
    assert.equal((await calls(page, historical.answer)).length, 0);
    await enablePhone(page);
    await page.waitForTimeout(2700);
    assert.equal((await calls(page, historical.answer)).length, 0, "Enabling voice does not replay historical answers");
    const confirmation = (await calls(page, "Voice is on."))[0];
    assert.equal(confirmation.userActivation, true);
    await page.getByRole("button", { name: "Test voice", exact: true }).click();
    await until(async () => (await delivered(page, "Voice is on.")).length === 2, "Explicit Test voice control plays its confirmation");
    assert.equal((await calls(page, "Voice is on."))[1].userActivation, true);
    await page.evaluate(() => { window.__voiceQA.timeline = []; });
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await until(() => page.evaluate(() => window.__voiceQA.cameraRequests > 0), "Record begins camera request");
    const timeline = await page.evaluate(() => window.__voiceQA.timeline);
    assert.equal(timeline[0]?.kind, "speech", "Voice warmup must run before awaiting camera permission");
    assert.equal(timeline[0]?.text, "Voice is on.");
    assert.equal((await calls(page, "Voice is on.")).at(-1).userActivation, true);
  });

  await test("phone draft is silent; failed reviewed playback retries explicitly once and never duplicates while pending", async () => {
    const model = fixture(); const page = await pageFor("phone-review-retry", model);
    await enablePhone(page);
    const candidate = answer("PHONE_CHECKED_RETRY_RESPONSE", false);
    model.answers = [candidate]; model.turns = [turn(candidate)];
    await page.getByText(candidate.answer, { exact: true }).first().waitFor();
    await page.waitForTimeout(2700);
    assert.equal((await calls(page, candidate.answer)).length, 0, "Completed turn cannot bypass its unreviewed answer receipt");
    assert(await page.getByRole("button", { name: "Read answer aloud", exact: true }).isDisabled());
    await mode(page, "not-allowed");
    model.answers = [answer(candidate.answer)];
    await until(async () => (await calls(page, candidate.answer)).length === 1, "Reviewed answer playback attempted");
    await page.getByText(/browser blocked voice/i).waitFor();
    assert.equal((await delivered(page, candidate.answer)).length, 0);
    await page.waitForTimeout(2800);
    assert.equal((await calls(page, candidate.answer)).length, 1, "Blocked playback must not loop on polls");
    await mode(page, "hold");
    await page.getByRole("button", { name: "Retry voice", exact: true }).click();
    await until(async () => (await calls(page, candidate.answer)).length === 2, "User retries the actual failed answer");
    await page.waitForTimeout(2800);
    assert.equal((await calls(page, candidate.answer)).length, 2, "Pending playback has one in-flight attempt");
    assert.equal((await delivered(page, candidate.answer)).length, 0, "onstart alone does not mark delivery");
    await page.evaluate(() => window.__voiceQA.finish());
    await until(async () => (await delivered(page, candidate.answer)).length === 1, "Delivery requires successful end");
    await page.waitForTimeout(2800);
    assert.equal((await calls(page, candidate.answer)).length, 2, "Successful explicit retry is marked delivered for future polls");
    await mode(page, "success");
    await page.getByRole("button", { name: "Read answer aloud", exact: true }).click();
    await until(async () => (await delivered(page, candidate.answer)).length === 2, "Manual Read answer remains available");
    await page.screenshot({ path: path.join(artifacts, "phone-retried.png"), fullPage: true });
  });

  await test("phone no-start watchdog releases playback and permits a successful gesture retry", async () => {
    const model = fixture(); const page = await pageFor("phone-watchdog", model);
    await enablePhone(page); await mode(page, "no-events");
    const candidate = answer("PHONE_WATCHDOG_RESPONSE");
    model.answers = [candidate]; model.turns = [turn(candidate)];
    await page.getByText(/did not start within 5 seconds/i).waitFor();
    assert.equal((await delivered(page, candidate.answer)).length, 0);
    await page.waitForTimeout(2700);
    assert.equal((await calls(page, candidate.answer)).length, 1);
    await mode(page, "success");
    await page.getByRole("button", { name: "Retry voice", exact: true }).click();
    await until(async () => (await delivered(page, candidate.answer)).length === 1, "Timed-out voice can recover");
    await page.waitForTimeout(2700);
    assert.equal((await calls(page, candidate.answer)).length, 2);
  });

  await test("phone session expiry cancels active speech and stops delivery retries", async () => {
    const model = fixture(); const page = await pageFor("phone-auth-cancel", model);
    await enablePhone(page); await mode(page, "hold");
    const candidate = answer("PHONE_CANCEL_ON_401");
    model.answers = [candidate]; model.turns = [turn(candidate)];
    await until(async () => (await calls(page, candidate.answer)).some((call) => call.started), "Voice is actively playing");
    const before = await page.evaluate(() => window.__voiceQA.cancels);
    model.unauthorized = true;
    await page.getByRole("heading", { name: "Open your memory.", exact: true }).waitFor();
    assert((await page.evaluate(() => window.__voiceQA.cancels)) > before, "Auth expiry cancels synthesis");
    assert.equal(await page.evaluate(() => window.__voiceQA.active.size), 0);
    await page.waitForTimeout(2700);
    assert.equal((await calls(page, candidate.answer)).length, 1);
    assert.equal((await delivered(page, candidate.answer)).length, 0);
  });

  await test("phone manual Read during autoplay cannot cause a poll-driven duplicate", async () => {
    const model = fixture(); const page = await pageFor("phone-manual-overlap", model);
    await enablePhone(page); await mode(page, "hold");
    const candidate = answer("PHONE_MANUAL_OVERLAP_RESPONSE");
    model.answers = [candidate]; model.turns = [turn(candidate)];
    await until(async () => (await calls(page, candidate.answer)).some((call) => call.started), "Checked autoplay has started");
    await page.getByRole("button", { name: "Read answer aloud", exact: true }).click();
    await page.waitForTimeout(100);
    const afterManual = (await calls(page, candidate.answer)).length;
    assert(afterManual >= 1 && afterManual <= 2, "One manual action can restart playback at most once");
    await page.waitForTimeout(2700);
    assert.equal((await calls(page, candidate.answer)).length, afterManual, "Polls do not interrupt manual reading");
    await page.evaluate(() => window.__voiceQA.finish());
    await until(async () => (await delivered(page, candidate.answer)).length === 1, "The user's selected reading finishes successfully");
    await page.waitForTimeout(2700);
    assert.equal((await calls(page, candidate.answer)).length, afterManual, "Completion must not expose a canceled autoplay key for replay");
  });

  await test("dashboard speaks only a submitted reviewed answer once, supports manual reading, and cancels on401", async () => {
    const model = fixture(), historical = answer("DASHBOARD_HISTORICAL_RESPONSE");
    model.answers = [historical];
    const page = await pageFor("dashboard-review", model, "/");
    const composer = page.locator(".card-ask");
    await page.waitForTimeout(3300);
    assert.equal((await calls(page, historical.answer)).length, 0, "Existing checked answer cards never autoplay as history");
    await composer.getByRole("button", { name: "Test voice", exact: true }).click();
    await until(async () => (await delivered(page, "Voice is on.")).length === 1, "Dashboard direct gesture can test voice");
    assert.equal((await calls(page, "Voice is on."))[0].userActivation, true);
    const candidate = answer("DASHBOARD_CHECKED_RESPONSE", false, "66666666-6666-4666-8666-666666666666");
    model.ask = candidate;
    await page.getByRole("textbox", { name: "Ask about your recordings", exact: true }).fill(candidate.question);
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await until(async () => (await delivered(page, "I'll check that.")).length === 1, "Submit gesture enables future reviewed playback");
    assert.equal((await calls(page, "I'll check that."))[0].userActivation, true);
    await composer.getByText(candidate.answer, { exact: true }).waitFor();
    assert(await composer.getByRole("button", { name: "Read answer aloud", exact: true }).isDisabled());
    assert.equal((await calls(page, candidate.answer)).length, 0);
    await mode(page, "hold");
    model.answers = [answer(candidate.answer, true, candidate.id)];
    await until(async () => (await calls(page, candidate.answer)).some((call) => call.started), "Reviewed dashboard answer starts automatically");
    await page.waitForTimeout(3300);
    assert.equal((await calls(page, candidate.answer)).length, 1, "Dashboard poll does not duplicate in-flight playback");
    await page.evaluate(() => window.__voiceQA.finish());
    await until(async () => (await delivered(page, candidate.answer)).length === 1, "Reviewed autoplay finishes once");
    await mode(page, "success");
    await composer.getByRole("button", { name: "Read answer aloud", exact: true }).click();
    await until(async () => (await delivered(page, candidate.answer)).length === 2, "Checked answer supports manual reading");
    await mode(page, "hold");
    await composer.getByRole("button", { name: "Read answer aloud", exact: true }).click();
    await until(async () => (await calls(page, candidate.answer)).filter((call) => call.started).length === 3, "Manual speech is active before auth expiry");
    const before = await page.evaluate(() => window.__voiceQA.cancels);
    model.unauthorized = true;
    await page.getByRole("heading", { name: "Open your memory.", exact: true }).waitFor();
    assert((await page.evaluate(() => window.__voiceQA.cancels)) > before);
    assert.equal(await page.evaluate(() => window.__voiceQA.active.size), 0);
    assert.equal((await delivered(page, candidate.answer)).length, 2);
  });

  await test("dashboard blocked voice and no-start watchdog expose retry without falsely marking playback", async () => {
    const model = fixture(); const page = await pageFor("dashboard-retry", model, "/");
    const composer = page.locator(".card-ask");
    const candidate = answer("DASHBOARD_RETRY_RESPONSE", false);
    model.ask = candidate;
    await page.getByRole("textbox", { name: "Ask about your recordings", exact: true }).fill(candidate.question);
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await until(async () => (await delivered(page, "I'll check that.")).length === 1, "Submit acknowledgement completes");
    await mode(page, "not-allowed");
    model.answers = [answer(candidate.answer)];
    await composer.getByRole("alert").filter({ hasText: /browser blocked the voice/i }).waitFor();
    await page.waitForTimeout(3300);
    assert.equal((await calls(page, candidate.answer)).length, 1);
    assert.equal((await delivered(page, candidate.answer)).length, 0);
    await mode(page, "no-events");
    await composer.getByRole("button", { name: "Retry voice", exact: true }).click();
    await composer.getByRole("alert").filter({ hasText: /voice did not start/i }).waitFor();
    assert.equal((await calls(page, candidate.answer)).length, 2);
    assert.equal((await delivered(page, candidate.answer)).length, 0);
    await mode(page, "success");
    await composer.getByRole("button", { name: "Retry voice", exact: true }).click();
    await until(async () => (await delivered(page, candidate.answer)).length === 1, "Dashboard retry recovers after no-start timeout");
    await page.waitForTimeout(3300);
    assert.equal((await calls(page, candidate.answer)).length, 3, "Retry success cannot cause poll-driven repeat");
    await page.screenshot({ path: path.join(artifacts, "dashboard-retried.png"), fullPage: true });
  });

  await test("dashboard reviewed answer arriving while hidden is deferred and speaks once on return", async () => {
    const model = fixture(); const page = await pageFor("dashboard-hidden-review", model, "/");
    const composer = page.locator(".card-ask");
    const candidate = answer("DASHBOARD_HIDDEN_RESPONSE", false);
    model.ask = candidate;
    await page.getByRole("textbox", { name: "Ask about your recordings", exact: true }).fill(candidate.question);
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await until(async () => (await delivered(page, "I'll check that.")).length === 1, "Initial gesture acknowledgement completes");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    model.answers = [answer(candidate.answer)];
    await composer.getByText("Verified answer", { exact: true }).waitFor();
    await page.waitForTimeout(3300);
    assert.equal((await calls(page, candidate.answer)).length, 0, "Hidden document cannot play an answer");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await until(async () => (await delivered(page, candidate.answer)).length === 1, "A reviewed answer deferred by visibility plays when the user returns");
    await page.waitForTimeout(3300);
    assert.equal((await calls(page, candidate.answer)).length, 1, "Returning cannot create a repeat on subsequent polls");
  });
} finally {
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser.close();
  report.unexpected_console_errors = report.console_errors.filter((item) => !/^Failed to load resource: the server responded with a status of (401|404|503)\b/.test(item.message));
  report.passed = report.cases.length > 0 && report.cases.every((item) => item.passed) && report.javascript_errors.length === 0 && report.unexpected_console_errors.length === 0;
  await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, artifacts, cases: report.cases.length, javascript_errors: report.javascript_errors, unexpected_console_errors: report.unexpected_console_errors }));
  if (!report.passed) process.exitCode = 1;
}
