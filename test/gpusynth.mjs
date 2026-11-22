import { chromium } from "playwright";
import path from "node:path";
const EXT = path.resolve("dist");
const ctx = await chromium.launchPersistentContext(path.resolve("test/.profile-gpu"), { channel: "chromium", headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const r = await sw.evaluate(async () => {
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "probe" });
  await new Promise((r) => setTimeout(r, 800));
  const t0 = performance.now();
  const l = await chrome.runtime.sendMessage({ target: "offscreen", type: "load", tabId: -1, device: "webgpu" });
  const t1 = performance.now();
  const s = await chrome.runtime.sendMessage({ target: "offscreen", type: "synth", tabId: -1, words: ["Hello", "there."], voice: "af_heart", speed: 1, device: "webgpu" });
  const st = await chrome.runtime.sendMessage({ target: "offscreen", type: "status" });
  return { l, loadMs: Math.round(t1 - t0), synth: s.ok ? { secs: s.secs, genMs: s.genMs, times: s.times, device: s.device } : s, st };
});
console.log(JSON.stringify(r));
await ctx.close();
