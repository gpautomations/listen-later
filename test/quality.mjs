// Quality check: fp32 (High) vs fp16 (Fast) on WASM. Peaks, clipping, similarity, alignment, speed.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { extensionContextOptions } from "./browser.mjs";
const EXT = path.resolve(process.env.EXT || "dist");
const ctx = await chromium.launchPersistentContext(path.resolve("test/.profile"), extensionContextOptions(EXT));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const sentences = [
  "Every era is shaped by its miracle material.",
  "My co-founder Simon was what we call a 10× programmer, but he rarely writes code these days.",
  "In 1879, Edison's lab spent $40,000 on the problem, and Mr. Upton ran the numbers at 3:30 a.m.",
  "He queues tasks before lunch or bed, letting them work while he's away.",
];
const res = await sw.evaluate(async (sentences) => {
  if (!(await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length)
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "quality test" });
  await new Promise((r) => setTimeout(r, 500));
  const dec = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); };
  const out = {};
  for (const quality of ["fast", "high"]) {
    const t0 = performance.now();
    const l = await chrome.runtime.sendMessage({ target: "offscreen", type: "load", tabId: -1, device: "wasm", quality });
    const loadMs = Math.round(performance.now() - t0);
    const rows = [];
    for (const s of sentences) {
      const r = await chrome.runtime.sendMessage({ target: "offscreen", type: "synth", tabId: -1, words: s.split(" "), voice: "af_heart", speed: 1, device: "wasm", quality });
      const a = dec(r.f32);
      rows.push({ secs: +r.secs.toFixed(2), genMs: r.genMs, rtf: r.rtf, peak: r.peak, scaled: r.scaled, dtype: r.dtype, n: a.length, audio: Array.from(a) });
    }
    out[quality] = { load: l, loadMs, rows };
  }
  // similarity fp16 vs fp32
  out.sim = out.fast.rows.map((f, i) => {
    const h = out.high.rows[i]; const n = Math.min(f.n, h.n);
    let num = 0, den = 0, cf = 0, ch = 0, ff = 0, hh = 0;
    for (let k = 0; k < n; k++) { const d = f.audio[k] - h.audio[k]; num += h.audio[k] ** 2; den += d * d; cf += f.audio[k] * h.audio[k]; ff += f.audio[k] ** 2; hh += h.audio[k] ** 2; }
    return { sameLength: f.n === h.n, snrDb: +(10 * Math.log10(num / den)).toFixed(1), corr: +(cf / Math.sqrt(ff * hh)).toFixed(4) };
  });
  out.status = await chrome.runtime.sendMessage({ target: "offscreen", type: "status" });
  return out;
}, sentences);
// write wavs for listening
const wav = (f32, file) => { const b = Buffer.alloc(44 + f32.length * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + f32.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(f32.length * 2, 40); f32.forEach((x, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), 44 + i * 2)); fs.writeFileSync(file, b); };
fs.mkdirSync("test/audio", { recursive: true });
for (const q of ["fast", "high"]) res[q].rows.forEach((r, i) => { wav(r.audio, `test/audio/${q}-${i + 1}.wav`); delete r.audio; });
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync("test/quality-report.json", JSON.stringify(res, null, 1));
await ctx.close();
