#!/usr/bin/env node
// Actual IndexedDB persistence in each engine, using synthetic source bytes.
// This does not substitute IndexedDB callbacks or claim physical device coverage.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require("playwright");
const web = path.resolve("web");
const folder = (await fs.readdir(path.join(web, "node_modules/.pnpm"))).find((name) =>
  name.startsWith("esbuild@"),
);
const esbuild = require(path.join(web, "node_modules/.pnpm", folder, "node_modules/esbuild"));
const bundled = await esbuild.build({
  entryPoints: [path.join(web, "lib/phone-storage.ts")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "PhoneStorage",
  platform: "browser",
});
const server = http.createServer((req, res) => {
  if (req.url === "/storage.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(bundled.outputFiles[0].text);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<script src="/storage.js"></script><p>Synthetic phone storage check</p>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const report = {
  scope:
    "Real Chromium and WebKit IndexedDB; exact synthetic source-byte round trips, reload recovery and bounded upload batches.",
  cases: [],
};
try {
  for (const [engine, api] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await api.launch({
      headless: true,
      ...(engine === "chromium"
        ? {
            executablePath:
              process.env.REWIND_TEST_CHROME ||
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {}),
    });
    try {
      const page = await browser.newPage();
      await page.goto(origin);
      const before = await page.evaluate(async () => {
        const store = PhoneStorage;
        const bytes = new Uint8Array(4 * 1024 * 1024 + 27);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
        const blob = new Blob([bytes], { type: "video/mp4" });
        const session = {
          id: "synthetic-day",
          mime: blob.type,
          startedAt: 100,
          lastAt: 102,
          chunks: 1,
          closed: false,
        };
        await store.write(
          {
            id: "original",
            boot: session.id,
            seq: 0,
            kind: "video",
            at: 100,
            blob,
            intent: "memory",
          },
          session,
        );
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        canvas.getContext("2d").fillRect(0, 0, 64, 64);
        const photo = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg"));
        await store.write({
          id: "photo",
          boot: "synthetic-photo",
          seq: 0,
          kind: "frame",
          at: 101,
          blob: photo,
          intent: "scan",
        });
        await store.write({
          id: "question",
          boot: "synthetic-question",
          seq: 0,
          kind: "conversation_audio",
          at: 103,
          blob: new Blob(["synthetic audio bytes"], { type: "audio/mp4" }),
          intent: "question",
        });
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        return {
          hash,
          bytes: bytes.length + photo.size + 21,
          queue: await store.queueInfo(),
          batch: (await store.chunks()).map((item) => item.id),
        };
      });
      assert.equal(before.queue.count, 3);
      assert.equal(before.batch.length, 2);
      assert.equal(before.batch[0], "question");
      // A new document must recover the durable queue and original session.
      await page.reload();
      const after = await page.evaluate(async () => {
        const store = PhoneStorage;
        const recovered = await store.recoverSessions();
        const chunks = await store.chunks(10),
          original = chunks.find((item) => item.id === "original");
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", await original.blob.arrayBuffer())),
        )
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        const marker = JSON.parse(
          await chunks.find((item) => item.kind === "recording_end").blob.text(),
        );
        const photo = chunks.find((item) => item.id === "photo");
        const result = {
          hash,
          recovered,
          mime: original.blob.type,
          originalBytes: original.blob.size,
          photoMime: photo.blob.type,
          marker,
          queue: await store.queueInfo(),
        };
        for (const item of chunks)
          await store.write(item.id, item.kind === "recording_end" ? item.boot : undefined);
        result.afterDelete = await store.queueInfo();
        return result;
      });
      assert.equal(
        after.hash,
        before.hash,
        "Exact original source bytes survive commit and reload",
      );
      assert.equal(after.mime, "video/mp4");
      assert.equal(after.photoMime, "image/jpeg");
      assert.equal(after.recovered, true);
      assert.equal(after.marker.reason, "page_closed");
      assert.equal(after.marker.chunks, 1);
      assert.equal(after.queue.count, 4);
      assert.deepEqual(after.afterDelete, { count: 0, bytes: 0 });
      if (engine === "chromium") {
        const legacy = await page.evaluate(async () => {
          const db = await PhoneStorage.database();
          await new Promise((resolve, reject) => {
            const tx = db.transaction("chunks", "readwrite");
            tx.objectStore("chunks").put({
              id: "legacy",
              boot: "previous-app",
              seq: 0,
              kind: "audio",
              at: 1,
              intent: "memory",
              blob: new Blob(["legacy original"], { type: "audio/webm" }),
            });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          const row = (await PhoneStorage.chunks())[0];
          const value = { text: await row.blob.text(), mime: row.blob.type };
          await PhoneStorage.write(row.id);
          return value;
        });
        assert.deepEqual(
          legacy,
          { text: "legacy original", mime: "audio/webm" },
          "Previously queued Blob rows remain readable",
        );
      }
      report.cases.push({
        engine,
        passed: true,
        originalBytes: after.originalBytes,
        recoveredReason: after.marker.reason,
      });
      console.log(JSON.stringify(report.cases.at(-1)));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
const out = path.resolve("data/ui-integration/phone-storage-" + Date.now() + ".json");
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(report, null, 2));
console.log(out);
