#!/usr/bin/env node
// Focused real-browser QR sign-in regression. Run via run_qr_pairing_test.py.
// A scanned QR opens /phone/#connect=<ticket>; no code entry or media capture.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = new URL(process.env.QR_TEST_URL || "http://127.0.0.1:0");
const token = process.env.QR_TEST_TOKEN || "";
const artifacts = path.resolve(process.env.QR_TEST_ARTIFACTS || ".");
const database = path.resolve(process.env.QR_TEST_DB || ".");
const privateRoot = path.join(root, "data/qr-pairing") + path.sep;
assert.equal(origin.hostname, "127.0.0.1", "QR tests require the isolated loopback API");
assert(origin.port && origin.port !== "0");
assert(token.startsWith("qr-test-"));
assert(artifacts.startsWith(privateRoot) && database.startsWith(artifacts + path.sep));
assert(database.endsWith("/workspace/rewind.sqlite3"));
const secrets = new Set([token]);
const redact = (value) => {
  let text = String(value);
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  return text;
};
const report = {
  scope: "Fresh local API, real ticket redemption and session cookies; no production data, manual code entry, recording, or model calls.",
  cases: [], javascript_errors: [], console_errors: [],
};
async function admin(endpoint, init = {}) {
  const response = await fetch(new URL("/api" + endpoint, origin), { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  assert(response.ok, `Fixture API returned ${response.status}`);
  return response.json();
}
async function invitation() {
  const result = await admin("/pairing", { method: "POST" });
  secrets.add(result.ticket); secrets.add(result.code);
  return result;
}
const initial = await admin("/status");
assert.equal(initial.provider, "disabled");
assert.equal(initial.workers, 0);
assert.equal(initial.received, 0);
const browser = await chromium.launch({
  executablePath: process.env.REWIND_TEST_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
  headless: true,
});
const contexts = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(message);
}
async function newPhone(label, cookie = undefined) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(context);
  if (cookie) await context.addCookies(cookie);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => report.javascript_errors.push({ label, error: redact(error.message) }));
  page.on("console", (message) => { if (message.type() === "error") report.console_errors.push({ label, error: redact(message.text()) }); });
  return page;
}
async function noManualEntry(page) {
  assert.equal(await page.locator("#pairing-code, #token").count(), 0, "QR sign-in must not render a pairing-code or access-key field");
  assert.equal(await page.getByLabel("Pairing code", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Workspace access key", { exact: true }).count(), 0);
}
async function assertNoTicketOnPage(page, ticket) {
  assert.equal(new URL(page.url()).hash, "", "Invitation is removed from history");
  const text = await page.locator("body").innerText();
  assert(!text.includes(ticket), "Invitation must not be rendered as page content");
}
async function assertPhoneSession(page) {
  const record = page.getByRole("button", { name: "Record", exact: true });
  await record.waitFor();
  // Playwright's visible state includes opacity:0. Wait for the actual phone
  // entrance animation so a transparent recorder cannot pass visual QA.
  await until(() => record.evaluate((element) => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (Number(getComputedStyle(parent).opacity) < 0.99) return false;
    }
    return true;
  }), "The signed-in Record button must finish appearing");
  assert(await record.isEnabled(), "QR sign-in leaves Record ready to use");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "Phone must not overflow horizontally");
  assert((await page.request.get(new URL("/api/status", origin).href)).ok(), "Phone has a real authenticated API session");
  const cookie = (await page.context().cookies()).find((item) => item.name === "rewind_session");
  assert(cookie?.httpOnly, "QR must create an HttpOnly session cookie");
  assert(cookie.expires > Date.now() / 1000 + 25 * 86400, "QR remembers this phone");
  assert(!(await page.evaluate(() => document.cookie)).includes("rewind_session="), "Session is not JavaScript-readable");
  return [cookie];
}
async function delayedRedemption(page, ticket, screenshot) {
  let release, requests = 0;
  await page.route("**/api/pair", async (route) => {
    requests++;
    const body = route.request().postDataJSON();
    assert(body.ticket === ticket && !body.code, "Phone submits the scanned invitation without asking for a code");
    await new Promise((resolve) => { release = resolve; });
    await route.continue();
  });
  await page.goto(new URL("/phone/#connect=" + encodeURIComponent(ticket), origin).href);
  await until(() => !!release, "QR redemption should begin automatically");
  await page.getByRole("heading", { name: /connecting/i }).waitFor();
  await noManualEntry(page);
  await assertNoTicketOnPage(page, ticket);
  await page.waitForTimeout(700);
  await noManualEntry(page);
  assert.equal(requests, 1, "Only one redemption request may run");
  await page.screenshot({ path: path.join(artifacts, screenshot) });
  release();
  const cookie = await assertPhoneSession(page);
  await assertNoTicketOnPage(page, ticket);
  await page.reload();
  await assertPhoneSession(page);
  assert.equal(requests, 1, "Reload must use the session, not replay the consumed invitation");
  return cookie;
}
async function rejectedQr(ticket, label) {
  const page = await newPhone(label);
  let status;
  page.on("response", (response) => { if (new URL(response.url()).pathname === "/api/pair") status = response.status(); });
  await page.goto(new URL("/phone/#connect=" + encodeURIComponent(ticket), origin).href);
  await page.getByRole("heading", { name: "This QR code couldn’t connect.", exact: true }).waitFor();
  await page.getByText("Create a new QR code on your computer and scan it again. No access code is needed.", { exact: true }).waitFor();
  await until(() => status !== undefined, "QR rejection reaches the browser");
  assert.equal(status, 401, "Invalid invitation is rejected by the actual API");
  await noManualEntry(page);
  await assertNoTicketOnPage(page, ticket);
  assert.equal((await page.request.get(new URL("/api/status", origin).href)).status(), 401);
  assert.equal(await page.getByRole("button", { name: "Record", exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifacts, `${label}.png`) });
}
async function test(name, run) {
  const first = contexts.length, began = Date.now();
  try { await run(); report.cases.push({ name, passed: true, seconds: (Date.now() - began) / 1000 }); }
  catch (error) { report.cases.push({ name, passed: false, seconds: (Date.now() - began) / 1000, error: redact(error.stack || error) }); }
  finally { await Promise.allSettled(contexts.slice(first).map((context) => context.close())); }
  console.log(JSON.stringify(report.cases.at(-1)));
  await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
}
let consumedTicket, phoneCookie;
try {
  await test("scanned QR shows Connecting during slow redemption, then opens the phone with no code", async () => {
    const link = await invitation(); consumedTicket = link.ticket;
    const page = await newPhone("fresh-QR");
    phoneCookie = await delayedRedemption(page, link.ticket, "connecting.png");
    await page.screenshot({ path: path.join(artifacts, "paired-phone.png") });
  });
  await test("used QR is single-use and asks for a fresh scan rather than an access code", async () => {
    assert(consumedTicket && phoneCookie, "Successful initial redemption is required");
    await rejectedQr(consumedTicket, "used-QR");
  });
  await test("expired QR asks for a fresh scan without a manual-code form", async () => {
    const link = await invitation();
    // The runner owns this temporary database. Exercise actual backend expiry,
    // rather than mocking a401 or waiting for the ten-minute invitation TTL.
    execFileSync(process.env.QR_TEST_PYTHON, ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE browser_pairings SET expires_at=0'); c.commit(); c.close()", database], { stdio: "pipe" });
    await rejectedQr(link.ticket, "expired-QR");
  });
  await test("invalid QR fails closed with fresh-scan guidance and no access-key fallback", async () => {
    const invalid = "invalid-qr-fixture-invitation"; secrets.add(invalid);
    await rejectedQr(invalid, "invalid-QR");
  });
  await test("a new QR is redeemed even when the phone already has a valid session", async () => {
    assert(phoneCookie, "An existing real session is required");
    const link = await invitation();
    const page = await newPhone("existing-session", phoneCookie);
    await delayedRedemption(page, link.ticket, "connecting-existing-session.png");
  });
  await test("temporary connection failure retries the scanned invitation without asking for a code", async () => {
    const link = await invitation();
    const page = await newPhone("retry-QR");
    let attempts = 0;
    await page.route("**/api/pair", async (route) => {
      attempts++;
      const body = route.request().postDataJSON();
      assert(body.ticket === link.ticket && !body.code, "Retry must retain the scanned invitation privately");
      if (attempts === 1) await route.abort("failed");
      else await route.continue();
    });
    await page.goto(new URL("/phone/#connect=" + encodeURIComponent(link.ticket), origin).href);
    const retry = page.getByRole("button", { name: "Try connecting again", exact: true });
    await retry.waitFor();
    await noManualEntry(page);
    await assertNoTicketOnPage(page, link.ticket);
    await retry.click();
    await assertPhoneSession(page);
    assert.equal(attempts, 2);
    await assertNoTicketOnPage(page, link.ticket);
  });
} finally {
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser.close();
  report.unexpected_console_errors = report.console_errors.filter((item) => !/^Failed to load resource: the server responded with a status of (401|404|503)\b/.test(item.error) && !(item.label === "retry-QR" && /^Failed to load resource: net::ERR_FAILED$/.test(item.error)));
  report.passed = report.cases.length === 6 && report.cases.every((item) => item.passed) && report.javascript_errors.length === 0 && report.unexpected_console_errors.length === 0;
  await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, artifacts, javascript_errors: report.javascript_errors, unexpected_console_errors: report.unexpected_console_errors }));
  if (!report.passed) process.exitCode = 1;
}
