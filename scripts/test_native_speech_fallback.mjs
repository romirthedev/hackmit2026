#!/usr/bin/env node
// Real browser speech events after simulated remote-TTS failure; synthetic text only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const engines = require("playwright");
const web = path.resolve("web");
const folder = (await fs.readdir(path.join(web, "node_modules/.pnpm"))).find((name) =>
  name.startsWith("esbuild@"),
);
const esbuild = require(path.join(web, "node_modules/.pnpm", folder, "node_modules/esbuild"));
const bundle = await esbuild.build({
  entryPoints: [path.join(web, "lib/server-speech.ts")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "SpeechModule",
  platform: "browser",
});
let outages = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/api/voice/status") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ deepgram: true }));
  } else if (req.url === "/api/voice/speak") {
    outages++;
    res.statusCode = 503;
    res.end("Synthetic speech-service outage");
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<button id="go">Start voice</button>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const report = {
  scope:
    "Compiled speech helper with real native speech events after simulated TTS HTTP503. No native speech callbacks are replaced. Does not verify physical speaker acoustics.",
  cases: [],
};
try {
  for (const engine of (process.env.UI_TEST_BROWSERS || "chromium,webkit").split(",")) {
    let browser;
    try {
      browser = await engines[engine].launch({
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
      const page = await browser.newPage({ hasTouch: true, isMobile: true });
      const unexpectedErrors = [];
      page.on("pageerror", (error) => unexpectedErrors.push(error.message));
      page.on("console", (entry) => {
        // HTTP 503 is the explicit fixture. Media loader errors are never expected.
        if (entry.type() === "error" && !/503/.test(entry.text()))
          unexpectedErrors.push(entry.text());
      });
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => {
        const speech = (window.testSpeech = new SpeechModule.ServerSpeech());
        window.events = [];
        document.querySelector("#go").onclick = async () => {
          speech.unlock();
          for (const text of ["Hello. I am Rewind.", "I can answer your next question."]) {
            // Playback must survive the end of the original user gesture.
            await new Promise((resolve) => setTimeout(resolve, 100));
            const ok = await speech.speak(text, () => events.push({ event: "start", text }));
            events.push({ event: "done", text, ok, error: speech.error });
          }
          window.done = true;
        };
      });
      await page.waitForFunction(() => window.testSpeech.enabled);
      const before = outages;
      await page.click("#go");
      await page.waitForFunction(() => window.done, null, { timeout: 25000 });
      const events = await page.evaluate(() => window.events);
      assert.equal(
        outages - before,
        2,
        "Both responses attempted the unavailable remote speech service",
      );
      assert.equal(events.filter((event) => event.event === "start").length, 2);
      assert.equal(
        events.filter((event) => event.event === "done" && event.ok && !event.error).length,
        2,
        "Both successive replies completed actual native speech",
      );
      assert.deepEqual(unexpectedErrors, [], "No media-loader or JavaScript errors");
      report.cases.push({ engine, passed: true, events });
    } catch (error) {
      report.cases.push({ engine, passed: false, error: error.stack });
    } finally {
      await browser?.close();
    }
    console.log(JSON.stringify(report.cases.at(-1)));
  }
} finally {
  server.close();
}
report.passed = report.cases.every((test) => test.passed);
const output = path.resolve("data/ui-integration/native-fallback-" + Date.now() + ".json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(output);
if (!report.passed) process.exitCode = 1;
