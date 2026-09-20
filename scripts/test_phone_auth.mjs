#!/usr/bin/env node
// Isolated browser/network regression. No production API, QR, account or model is used.
// Requires Playwright (NODE_PATH may point to a bundled runtime) and installed web dependencies.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const esbuildDirectory = (await fs.readdir(path.join(web, "node_modules/.pnpm"))).find((name) =>
  name.startsWith("esbuild@"),
);
const esbuild = require(
  path.join(web, "node_modules/.pnpm", esbuildDirectory, "node_modules/esbuild"),
);
const uiStub = `import React from 'react'; export default function Login(){return <h1>Open your memory.</h1>};
export const ComputerPanel=()=>null; export const ContextPanel=()=>null; export const PeoplePanel=()=>null;
export const FrameImage=()=>null;`;
const output = await esbuild.build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import Phone from ${JSON.stringify(path.join(web, "app/phone/page.tsx"))};
import {api} from ${JSON.stringify(path.join(web, "lib/api.ts"))};
window.probeApi=api;createRoot(document.getElementById('root')).render(<Phone/>);`,
    resolveDir: web,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  nodePaths: [path.join(web, "node_modules")],
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "isolated-auth-ui",
      setup(build) {
        // Exercise the actual phone component, API helper and capture persistence.
        // Unrelated panels/navigation styling are not needed for this regression.
        build.onResolve(
          { filter: /^@\/components\/(login|computer-panel|context-panel|people-panel|catalog)$/ },
          (args) => ({ path: args.path, namespace: "ui-stub" }),
        );
        build.onLoad({ filter: /.*/, namespace: "ui-stub" }, () => ({
          contents: uiStub,
          loader: "tsx",
          resolveDir: web,
        }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "link",
          namespace: "link-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "link-stub" }, () => ({
          contents: `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
          loader: "tsx",
          resolveDir: web,
        }));
        build.onResolve({ filter: /^@\// }, (args) => ({
          path: path.join(web, args.path.slice(2) + ".ts"),
        }));
      },
    },
  ],
});
const bundle = output.outputFiles[0].contents;
const server = http.createServer(async (req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(bundle);
    return;
  }
  if (req.url === "/audio/voice-worklet.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(await fs.readFile(path.join(web, "public/audio/voice-worklet.js")));
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const chrome =
    process.env.REWIND_TEST_CHROME ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    window.authTestStreams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      window.authTestStreams.push(stream);
      return stream;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [],
    requests = [];
  let statusRequests = 0,
    releaseInitial,
    releaseStale,
    holdStale = false;
  page.on("pageerror", (error) => errors.push(error.message));
  const status = {
    pending: 0,
    failed: 0,
    analyzed: 0,
    analysis_ready: false,
    verification_enabled: false,
    timezone: "America/New_York",
  };
  const respond = (route, code, data) =>
    route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    requests.push({ path: pathname, method: request.method() });
    if (pathname === "/api/expire") return respond(route, 401, { detail: "Unauthorized" });
    if (pathname === "/api/error-text")
      return respond(route, 403, { detail: "Keep this exact error message." });
    if (request.method() === "POST")
      return respond(route, 503, { detail: "Fixture offline; preserve original bytes." });
    if (pathname === "/api/status") {
      statusRequests++;
      if (statusRequests === 1)
        await new Promise((resolve) => {
          releaseInitial = resolve;
        });
      else if (holdStale) {
        holdStale = false;
        await new Promise((resolve) => {
          releaseStale = resolve;
        });
      }
      try {
        return await respond(route, 200, status);
      } catch {
        return;
      }
    }
    if (pathname === "/api/conversation/state")
      return respond(route, 200, { status: "listening", turns: [] });
    return respond(route, 200, []);
  });
  await page.goto(origin);
  await page.waitForTimeout(4400);
  assert.equal(statusRequests, 1, "Slow dashboard polls must not overlap");
  releaseInitial();
  await page.getByRole("button", { name: "Record", exact: true }).waitFor();
  const preserved = await page.evaluate(() =>
    window.probeApi("/error-text").catch((e) => ({ status: e.status, message: e.message })),
  );
  assert.deepEqual(preserved, { status: 403, message: "Keep this exact error message." });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop recording", exact: true }).waitFor();
  holdStale = true;
  while (!releaseStale) await page.waitForTimeout(100);
  const expired = await page.evaluate(() =>
    window.probeApi("/expire").catch((e) => ({ status: e.status, message: e.message })),
  );
  assert.deepEqual(expired, { status: 401, message: "Unauthorized" });
  await page.getByRole("heading", { name: "Open your memory.", exact: true }).waitFor();
  releaseStale();
  await page.waitForFunction(
    () =>
      window.authTestStreams.length > 0 &&
      window.authTestStreams.every((s) => s.getTracks().every((t) => t.readyState === "ended")),
  );
  await page.waitForTimeout(250);
  const afterExpiry = requests.length;
  await page.waitForTimeout(4500);
  assert.equal(
    requests.length,
    afterExpiry,
    "Login must stop dashboard, voice and capture retry polling",
  );
  assert.equal(
    await page.getByRole("button", { name: "Record", exact: true }).count(),
    0,
    "A stale200 must not reopen recording",
  );
  const queue = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("rewind-phone-recordings", 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction(["chunks", "sessions"]);
          const chunks = transaction.objectStore("chunks").getAll(),
            sessions = transaction.objectStore("sessions").getAll();
          transaction.oncomplete = () => {
            resolve({
              chunks: chunks.result.map((c) => ({ kind: c.kind, bytes: c.blob.size })),
              sessions: sessions.result.map((s) => ({ closed: s.closed, chunks: s.chunks })),
            });
            db.close();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
  assert(
    queue.chunks.some((c) => c.kind === "video" && c.bytes > 0),
    "Original video fragments must survive auth expiry",
  );
  assert(
    queue.chunks.some((c) => c.kind === "recording_end"),
    "Stopping for Login must durably finalize the recording",
  );
  assert(
    queue.sessions.length > 0 && queue.sessions.every((s) => s.closed),
    "Capture session must close without clearing original chunks",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        slowPollsDidNotOverlap: true,
        typed401Preserved: true,
        errorTextPreserved: true,
        stale200Rejected: true,
        loginPollingStopped: true,
        cameraTracksStopped: true,
        queuedOriginalsRetained: true,
        queue,
        apiRequests: requests.length,
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
