// 1280x800 Chrome Web Store screenshots on a CC BY-SA Wikipedia article (not Notion content).
import { chromium } from "playwright";
import http from "node:http";
import path from "node:path";
import { activateTab } from "./activate.mjs";
import { extensionContextOptions } from "./browser.mjs";
// Server host the build was configured with (local.config.json "defaultServer"); mapped to a mock on 127.0.0.1.
const TEST_HOST = process.env.LL_TEST_HOST || "my-computer.local";
const EXT = path.resolve(process.env.EXT || "dist");
const OUT = path.resolve("store/screenshots");
const URL = "https://en.wikipedia.org/wiki/Steam_engine";
const server = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.writeHead(202, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "x", status: "queued" })); }); });
await new Promise((r) => server.listen(7778, "127.0.0.1", r));
const ctx = await chromium.launchPersistentContext(path.resolve("test/.p-high"), extensionContextOptions(EXT, {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  extraArgs: [`--host-resolver-rules=MAP ${TEST_HOST.toLowerCase()} 127.0.0.1`],
}));
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
await sw.evaluate((h) => chrome.storage.local.set({ quality: "high", voice: "af_heart", speed: 1, serverUrl: `http://${h}:7778` }), TEST_HOST);
const declutter = (pg) => pg.evaluate(() => {
  document.querySelectorAll("#siteNotice, #centralNotice, [id^='frb'], [class*='frb'], .cn-fundraising, [class*='banner']").forEach((e) => e.remove());
  for (const e of document.querySelectorAll("body *")) { const cs = getComputedStyle(e); if ((cs.position === "fixed" || cs.position === "sticky") && /donat/i.test(e.textContent) && !e.closest("#listen-later-host")) e.remove(); }
});
const waitWord = (pg) => pg.waitForFunction(() => { const d = document.querySelector("#listen-later-host").dataset; return d.state === "playing" && document.querySelector(".ll-word"); }, null, { timeout: 60000 });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
await activateTab(sw, page);
const host = page.locator("#listen-later-host");
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.detected, null, { timeout: 30000 });
await page.waitForTimeout(2000); await declutter(page);
// start a few sentences in, at a paragraph near the top of the body
await page.evaluate(() => window.scrollTo(0, 0));
await host.locator("button.play").click();
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.firstAudioMs, null, { timeout: 300000 });
await page.waitForTimeout(800);
const target = await page.evaluate(() => { const ps = [...document.querySelectorAll("#mw-content-text p")].filter((p) => p.querySelector(".ll-w") && p.textContent.length > 300); const s = [...ps[1].querySelectorAll(".ll-w")].find((x) => !x.closest("a")); return +s.dataset.llw; });
await page.locator(`.ll-w[data-llw="${target}"]`).first().click();
await page.waitForTimeout(3000); await waitWord(page); await page.waitForFunction(() => !/Buffer/.test(document.querySelector("#listen-later-host").dataset.status), null, { timeout: 30000 }); await page.waitForTimeout(1200); await declutter(page);
await page.screenshot({ path: `${OUT}/1-read-along-on-the-original-page.png` });
await host.locator("button.gear").click(); await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/2-voices-speed-quality.png` });
await host.locator("button.gear").click();
await host.locator("button.phone").click();
await page.waitForFunction(() => /^ok: Sent/.test(document.querySelector("#listen-later-host").dataset.toast || ""), null, { timeout: 30000 });
await page.screenshot({ path: `${OUT}/3-send-to-my-phone.png` });
await host.locator("button.gear").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/4-always-on-this-site.png` });
await ctx.close(); server.close();
