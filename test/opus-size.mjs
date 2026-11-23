// Measure Opus file size and check that a tone burst lands on the original timeline.
// Uses Playwright's Chromium (WebCodecs). No extension and no Kokoro model.
import { chromium } from "playwright";
import http from "node:http";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: ["src/lib/speech-audio.mjs"],
  bundle: true,
  format: "esm",
  write: false,
  platform: "browser",
});
const js = bundled.outputFiles[0].text;
const pageHtml = `<!doctype html><meta charset="utf-8"><script type="module">
import { encodePcm } from "/speech-audio.js";
try {
const sr = 24000;
const seconds = 20;
const noise = new Float32Array(sr * seconds);
let state = 123456789;
for (let i = 0; i < noise.length; i++) {
  state = (1664525 * state + 1013904223) >>> 0;
  const env = 0.5 + 0.5 * Math.sin((i / sr) * 8);
  noise[i] = ((state / 4294967296) * 2 - 1) * 0.25 * env;
}
const burstAt = [1, 5, 12];
const burst = new Float32Array(sr * seconds);
for (const t of burstAt) {
  const start = Math.round(t * sr);
  for (let i = 0; i < Math.round(0.03 * sr); i++) burst[start + i] = Math.sin((i / sr) * Math.PI * 2 * 880);
}
const t0 = performance.now();
const speech = await encodePcm(noise, sr);
const tone = await encodePcm(burst, sr);
const ctx = new AudioContext();
if (ctx.state === "suspended") await ctx.resume();
const decoded = await ctx.decodeAudioData(tone.bytes.slice().buffer);
const ch = decoded.getChannelData(0);
function peakAt(target) {
  const center = Math.round(target * decoded.sampleRate);
  const win = Math.round(0.08 * decoded.sampleRate);
  let best = 0;
  let at = center;
  const a = Math.max(0, center - win);
  const b = Math.min(ch.length, center + win);
  for (let i = a; i < b; i++) if (Math.abs(ch[i]) > best) { best = Math.abs(ch[i]); at = i; }
  return { target, atSec: at / decoded.sampleRate, offsetMs: (at / decoded.sampleRate - target) * 1000, peak: best };
}
window.__result = {
  codec: speech.codec,
  mime: speech.mime,
  seconds,
  audioBytes: speech.bytes.length,
  bytesPerMin: Math.round(speech.bytes.length / seconds * 60),
  kbps: speech.bytes.length * 8 / seconds / 1000,
  encodeMs: Math.round(performance.now() - t0),
  decodedDuration: decoded.duration,
  durationErrorMs: (decoded.duration - seconds) * 1000,
  peaks: burstAt.map(peakAt),
};
} catch (e) { window.__err = String(e && e.stack || e); }
</script>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/speech-audio.js")) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(js);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(pageHtml);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await chromium.launch({ headless: false, args: ["--headless=new", "--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__result || window.__err, null, { timeout: 60000 });
  const result = await page.evaluate(() => window.__result || null);
  const err = await page.evaluate(() => window.__err || "");
  if (!result) throw new Error(err || errors.join(" | ") || "encoder produced no result");
  if (result.codec !== "opus") throw new Error("expected opus, got " + result.codec);
  if (result.kbps < 16 || result.kbps > 40) throw new Error("bitrate out of range: " + result.kbps.toFixed(2));
  for (const p of result.peaks) {
    if (Math.abs(p.offsetMs) > 15) throw new Error("timing off by " + p.offsetMs.toFixed(1) + " ms at " + p.target + "s");
    if (p.peak < 0.05) throw new Error("burst missing at " + p.target + "s");
  }
  console.log(JSON.stringify(result, null, 1));
  if (errors.length) console.log("page errors", errors);
} finally {
  await browser.close();
  server.close();
}
