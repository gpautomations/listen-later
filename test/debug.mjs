import { chromium } from "playwright";
import path from "node:path";
import { activateTab } from "./activate.mjs";
import { extensionContextOptions } from "./browser.mjs";
const EXT = path.resolve("dist");
const ctx = await chromium.launchPersistentContext(path.resolve("test/.profile"), extensionContextOptions(EXT));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const page = await ctx.newPage();
page.on("console", (m) => console.log("PAGE", m.type(), m.text().slice(0, 200)));
await page.goto("https://www.notion.com/blog/steam-steel-and-infinite-minds-ai", { waitUntil: "domcontentloaded" });
await activateTab(sw, page);
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
