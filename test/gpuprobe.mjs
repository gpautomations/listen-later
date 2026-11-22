import { chromium } from "playwright";
import path from "node:path";
const EXT = path.resolve("dist");
const ctx = await chromium.launchPersistentContext(path.resolve("test/.profile-gpu"), { channel: "chromium", headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const r = await sw.evaluate(async () => {
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "probe" });
  await new Promise((r) => setTimeout(r, 800));
  return "sw gpu: " + !!self.navigator.gpu;
});
const pg = await ctx.newPage();
await pg.goto(sw.url().replace("background.js", "offscreen.html"));
const a = await pg.evaluate(async () => { const ad = await navigator.gpu?.requestAdapter(); return ad ? JSON.stringify({ vendor: ad.info?.vendor, arch: ad.info?.architecture, desc: ad.info?.description, fallback: ad.info?.isFallbackAdapter }) : "no adapter"; });
console.log(r, a);
await ctx.close();
