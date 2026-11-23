// Open a saved episode the way a phone browser would: from an http link, mobile viewport.
// Chromium stands in for Chrome on Android. WebKit stands in for Safari and Chrome on iOS.
// This machine has no iPhone, so Files and Quick Look cannot be run here.
import { chromium, webkit } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: ["test/make-episode.mjs"],
  bundle: true,
  format: "esm",
  write: false,
  platform: "browser",
});
const js = bundled.outputFiles[0].text;
const maker = `<!doctype html><meta charset="utf-8"><script type="module">
import { makeEpisode } from "/make-episode.js";
try { window.__episode = await makeEpisode(); }
catch (e) { window.__err = String(e && e.stack || e); }
</script>`;

const files = new Map();
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/make-episode.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(js);
    return;
  }
  if (url === "/episode.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(files.get("episode") || "");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(maker);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const iphone = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

async function openEpisode(browserType, launchOptions, label) {
  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext(iphone);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/episode.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article img", { timeout: 5000 });
  const img = await page.locator("article img").evaluate((el) => ({
    prefix: el.getAttribute("src").slice(0, 22),
    width: el.naturalWidth,
    alt: el.alt,
  }));
  await page.locator("[data-s]").click();
  let played = false;
  try {
    await page.waitForFunction(() => {
      const audio = document.querySelector("audio");
      const word = document.querySelector("span.on");
      return !!(audio && !audio.paused && audio.currentTime > 0.15 && word);
    }, null, { timeout: 8000 });
    played = true;
  } catch (e) {
    errors.push(String(e).split("\n")[0]);
  }
  const state = await page.evaluate(() => {
    const audio = document.querySelector("audio");
    return {
      paused: audio.paused,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      errorCode: audio.error ? audio.error.code : 0,
      error: audio.error ? audio.error.message : "",
      highlighted: document.querySelector("span.on")?.textContent || "",
    };
  });
  await browser.close();
  return { label, played, img, state, errors };
}

const browser = await chromium.launch({ headless: false, args: ["--headless=new"] });
let made;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__episode || window.__err, null, { timeout: 20000 });
  made = await page.evaluate(() => window.__episode || { error: window.__err });
  if (errors.length) made.pageErrors = errors;
} finally {
  await browser.close();
}
if (!made?.html) {
  console.error(JSON.stringify(made, null, 2));
  process.exit(1);
}
files.set("episode", made.html);
const filePath = path.join(os.tmpdir(), "listen-later-episode-play.html");
fs.writeFileSync(filePath, made.html);

const report = {
  made: { codec: made.codec, mime: made.mime, imageType: made.imageType, imageBytes: made.imageBytes, audioBytes: made.audioBytes, htmlBytes: made.html.length },
  browsers: [],
};
report.browsers.push(await openEpisode(chromium, { headless: false, args: ["--headless=new", "--autoplay-policy=no-user-gesture-required"] }, "chromium-mobile"));
try {
  report.browsers.push(await openEpisode(webkit, { headless: true }, "webkit-mobile"));
} catch (e) {
  report.browsers.push({ label: "webkit-mobile", launchError: String(e && e.stack || e) });
}

const fileBrowser = await chromium.launch({ headless: false, args: ["--headless=new", "--autoplay-policy=no-user-gesture-required"] });
try {
  const context = await fileBrowser.newContext(iphone);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + filePath, { waitUntil: "domcontentloaded" });
  await page.locator("[data-s]").click();
  let played = false;
  try {
    await page.waitForFunction(() => {
      const audio = document.querySelector("audio");
      return !!(audio && !audio.paused && audio.currentTime > 0.15 && document.querySelector("span.on"));
    }, null, { timeout: 8000 });
    played = true;
  } catch (e) {
    errors.push(String(e).split("\n")[0]);
  }
  const state = await page.evaluate(() => {
    const audio = document.querySelector("audio");
    return { paused: audio.paused, currentTime: audio.currentTime, errorCode: audio.error ? audio.error.code : 0, highlighted: document.querySelector("span.on")?.textContent || "" };
  });
  report.fileUrl = { played, state, errors };
} finally {
  await fileBrowser.close();
}

console.log(JSON.stringify(report, null, 2));
const bad = report.browsers.filter((b) => b.launchError || !b.played);
if (bad.length) process.exit(1);
server.close();
