// Opens a private episode in Chromium at a phone size and a desktop size.
// Checks highlighting, seek, resume, robots, and that the page does not scroll sideways.
import { chromium } from "playwright";
import http from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import worker from "../src/index.js";
import { MemoryBucket } from "./memory-bucket.js";
import { buildSample } from "../scripts/sample-episode.mjs";

function wavTone(seconds, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const write = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  write(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, (i % 40) < 4 ? 6000 : 0, true);
  return bytes;
}

const live = {
  EPISODES: new MemoryBucket(),
  ABUSE_EMAIL: "abuse@example.com",
  ADMIN_TOKEN: "test-admin-token",
};

function serve(portReady) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      if (req.method !== "GET" && req.method !== "HEAD") {
        for await (const chunk of req) chunks.push(chunk);
      } else {
        req.resume();
      }
      const body = Buffer.concat(chunks);
      const host = req.headers.host || "127.0.0.1";
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request(`http://${host}${req.url}`, {
        method: req.method,
        headers,
        body: body.length && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });
      const response = await worker.fetch(request, live);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key === "content-length") return;
        res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err && err.stack || err));
    }
  });
  server.listen(0, "127.0.0.1", () => portReady(server));
}

const external = process.env.HOSTED_TEST_ORIGIN || "";
const server = external ? null : await new Promise((resolve) => serve(resolve));
const origin = external ? external.replace(/\/+$/, "") : `http://127.0.0.1:${server.address().port}`;
const secret = "c".repeat(43);

const form = new FormData();
form.append("manifest", new Blob([JSON.stringify({
  v: 1,
  title: "Seek check",
  sourceUrl: "https://www.gutenberg.org/ebooks/1342",
  voiceLabel: "Test",
  durationSec: 8,
  blocks: [{ type: "p", words: [{ text: "It", start: 0, end: 0.4 }, { text: "wife.", start: 3, end: 3.4 }] }],
})], { type: "application/json" }), "manifest.json");
form.append("audio", new Blob([wavTone(8)], { type: "audio/wav" }), "audio.wav");
const uploaded = await fetch(origin + "/api/episodes", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: form });
if (!uploaded.ok) throw new Error(await uploaded.text());
const created = await uploaded.json();

const sample = buildSample();
const sampleForm = new FormData();
sampleForm.append("manifest", new Blob([JSON.stringify(sample.manifest)], { type: "application/json" }), "manifest.json");
sampleForm.append("audio", new Blob([sample.audio], { type: "audio/webm" }), "audio.webm");
const sampleUp = await fetch(origin + "/api/episodes", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: sampleForm });
if (!sampleUp.ok) throw new Error(await sampleUp.text());
const sampleCreated = await sampleUp.json();

const outDir = process.env.ARTIFACT_DIR || "/tmp/listen-later-hosted";
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const report = { sampleUrl: sampleCreated.url, seekUrl: created.url };
try {
  for (const [name, viewport] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
    const page = await browser.newPage({ viewport });
    await page.goto(created.url, { waitUntil: "domcontentloaded" });
    await page.locator("audio").evaluate((el) => new Promise((resolve, reject) => {
      const done = () => resolve();
      const fail = () => reject(new Error("audio failed " + (el.error && el.error.code)));
      if (el.readyState >= 1) done();
      else {
        el.addEventListener("loadedmetadata", done, { once: true });
        el.addEventListener("error", fail, { once: true });
      }
      setTimeout(() => reject(new Error("audio metadata timed out, readyState " + el.readyState)), 8000);
    }));
    const meta = await page.evaluate(() => ({
      robots: document.querySelector('meta[name="robots"]')?.content || "",
      origin: document.querySelector("a.origin")?.textContent || "",
      href: document.querySelector("a.origin")?.href || "",
      report: document.querySelector("a.report")?.href || "",
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      playsinline: document.querySelector("audio")?.hasAttribute("playsinline"),
      title: navigator.mediaSession.metadata?.title || "",
    }));
    if (meta.robots !== "noindex, nofollow") throw new Error("robots " + meta.robots);
    if (meta.origin !== "Original article") throw new Error("credit missing");
    if (!meta.href.includes("gutenberg.org")) throw new Error("source link");
    if (!meta.report.startsWith("mailto:abuse@example.com")) throw new Error("report link");
    if (meta.scroll > meta.client + 1) throw new Error(`${name} horizontal overflow ${meta.scroll} > ${meta.client}`);
    if (!meta.playsinline) throw new Error("playsinline missing");
    if (meta.title !== "Seek check") throw new Error("media session title " + meta.title);
    await page.locator('span[data-s="3.000"]').click();
    const time = await page.locator("audio").evaluate((el) => el.currentTime);
    if (Math.abs(time - 3) > 0.05) throw new Error("seek landed at " + time);
    await page.locator("audio").evaluate((el) => el.dispatchEvent(new Event("timeupdate")));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("audio").evaluate((el) => new Promise((resolve, reject) => {
      if (el.readyState >= 1) resolve();
      else el.addEventListener("loadedmetadata", () => resolve(), { once: true });
      setTimeout(() => reject(new Error("resume metadata timed out")), 8000);
    }));
    const resume = await page.locator("#resume-text").textContent();
    if (!resume.includes("Back at")) throw new Error("resume text " + resume);
    const shot = path.join(outDir, `episode-${name}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    report[name] = { ...meta, time, resume, shot };
    await page.close();
  }
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(sampleCreated.url, { waitUntil: "domcontentloaded" });
  await phone.locator("audio").evaluate((el) => new Promise((resolve, reject) => {
    const ok = () => resolve();
    if (el.readyState >= 1) ok();
    else el.addEventListener("loadedmetadata", ok, { once: true });
    el.addEventListener("error", () => reject(new Error("sample audio failed " + (el.error && el.error.code))), { once: true });
    setTimeout(() => reject(new Error("sample metadata timed out, readyState " + el.readyState)), 8000);
  }));
  const sampleMeta = await phone.evaluate(() => ({
    words: document.querySelectorAll("[data-s]").length,
    duration: document.querySelector("audio").duration,
    title: document.querySelector("h1").textContent,
    type: "",
  }));
  const contentType = (await fetch(sampleCreated.url + "/audio", { headers: { range: "bytes=0-3" } }));
  sampleMeta.range = contentType.status;
  sampleMeta.contentType = contentType.headers.get("content-type");
  sampleMeta.magic = Buffer.from(await contentType.arrayBuffer()).toString("hex");
  if (sampleMeta.words < 40) throw new Error("sample words " + sampleMeta.words);
  if (!(sampleMeta.duration > 5)) throw new Error("sample duration " + sampleMeta.duration);
  if (sampleMeta.range !== 206) throw new Error("sample range " + sampleMeta.range);
  if (sampleMeta.contentType !== "audio/webm") throw new Error(sampleMeta.contentType);
  const sampleShot = path.join(outDir, "sample-mobile.png");
  await phone.screenshot({ path: sampleShot, fullPage: true });
  report.sample = { ...sampleMeta, url: sampleCreated.url, shot: sampleShot };
  await phone.close();
} finally {
  await browser.close();
  if (server) server.close();
}
console.log(JSON.stringify(report, null, 2));
