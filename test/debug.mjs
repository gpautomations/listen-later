import { chromium } from "playwright";
import path from "node:path";
const EXT = path.resolve("dist");
const ctx = await chromium.launchPersistentContext(path.resolve("test/.profile"), { channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required"] });
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const page = await ctx.newPage();
page.on("console", (m) => console.log("PAGE", m.type(), m.text().slice(0, 200)));
await page.goto("https://www.notion.com/blog/steam-steel-and-infinite-minds-ai", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.detected, null, { timeout: 30000 });
await page.locator("#listen-later-host button.play").click();
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(5000);
  const d = await page.evaluate(() => ({ ...document.querySelector("#listen-later-host").dataset }));
  const st = await sw.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "status" })).catch((e) => e.message);
  console.log(i, JSON.stringify(d), JSON.stringify(st).slice(0, 600));
  if (d.firstAudioMs) break;
}
await ctx.close();
