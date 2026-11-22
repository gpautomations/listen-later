// Robustness + speed per dtype on WASM: count silent/NaN sentences.
import { chromium } from "playwright";
import path from "node:path";
const EXT = path.resolve("dist");
const dtypes = (process.argv[2] || "fp16,fp32").split(",");
const ctx = await chromium.launchPersistentContext(path.resolve("test/.profile"), { channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const text = `Every era is shaped by its miracle material. Steel forged the Gilded Age. Semiconductors switched on the Digital Age. Now AI has arrived as infinite minds. If history teaches us anything, those who master the material define the era. In the 1850s, Andrew Carnegie was a telegraph boy running messages through the muddy streets of Pittsburgh. Sixty percent of Americans were farmers. Within two generations, Carnegie and his peers forged the modern world. Horses gave way to railroads, candlelight to electricity, iron to steel. Since then, work shifted from factories to offices. Today I run a software company in San Francisco, building tools for millions of knowledge workers. I don't have all the answers on what comes next. The first glimpses can be found with the high priests of knowledge work: programmers. He's become a manager of infinite minds. Hello. Yes! It works.`;
const sents = text.match(/[^.!?]+[.!?]/g).map((s) => s.trim());
const res = await sw.evaluate(async ([sents, dtypes]) => {
  if (!(await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length)
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "dtype test" });
  await new Promise((r) => setTimeout(r, 500));
  const dec = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); };
  const out = {};
  for (const dtype of dtypes) {
    const t0 = performance.now();
    const lr = await chrome.runtime.sendMessage({ target: "offscreen", type: "load", tabId: -1, device: "wasm", dtype }); if (!lr.ok) { out[dtype] = { loadError: lr.error }; continue; }
    const loadMs = Math.round(performance.now() - t0);
    let bad = [], gen = 0, aud = 0;
    for (const [i, s] of sents.entries()) {
      const r = await chrome.runtime.sendMessage({ target: "offscreen", type: "synth", tabId: -1, words: s.split(" "), voice: "af_heart", speed: 1, device: "wasm", dtype });
      if (!r.ok) { bad.push({ i, error: r.error?.slice(0, 200) }); if (bad.length > 3) break; continue; }
      const a = dec(r.f32); let nan = 0; for (const x of a) if (Number.isNaN(x)) nan++;
      if (nan || r.peak < 0.01) bad.push({ i, s: s.slice(0, 40), nan, n: a.length, peak: r.peak });
      gen += r.genMs; aud += r.secs;
    }
    out[dtype] = { loadMs, sentences: sents.length, bad, rtf: +(gen / 1000 / aud).toFixed(3) };
  }
  return out;
}, [sents, dtypes]);
console.log(JSON.stringify(res, null, 1));
await ctx.close();
