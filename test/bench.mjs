// Micro-benchmark of the offscreen engine: generation speed per config.
import { chromium } from "playwright";
import path from "node:path";
import { extensionContextOptions } from "./browser.mjs";
const EXT = path.resolve("dist");
const [threads, dtype, device] = [+(process.argv[2] || 4), process.argv[3] || "q8", process.argv[4] || "wasm"];
const ctx = await chromium.launchPersistentContext(path.resolve("test/.profile"), extensionContextOptions(EXT, {
  extraArgs: device === "webgpu" ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] : [],
}));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const res = await sw.evaluate(async ([threads, dtype, device]) => {
  const create = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (!create.length) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "bench" });
  await new Promise((r) => setTimeout(r, 500));
  const t0 = performance.now();
  const l = await chrome.runtime.sendMessage({ target: "offscreen", type: "load", tabId: -1, threads, dtype, device });
  const loadMs = Math.round(performance.now() - t0);
  const words = "Every era is shaped by its miracle material. Steel forged the Gilded Age, and semiconductors switched on the Digital Age, so now we ask what comes next.".split(" ");
  const out = [];
  for (let i = 0; i < 3; i++) { const r = await chrome.runtime.sendMessage({ target: "offscreen", type: "synth", tabId: -1, words, voice: "af_heart", speed: 1 }); out.push({ secs: +r.secs.toFixed(2), genMs: r.genMs, rtf: r.rtf }); }
  const st = await chrome.runtime.sendMessage({ target: "offscreen", type: "status" }); return { l, loadMs, out, st };
}, [threads, dtype, device]);
console.log(threads, dtype, JSON.stringify(res));
await ctx.close();
