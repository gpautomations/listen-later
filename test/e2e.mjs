// E2E: load the unpacked extension in Chromium (new headless), open article pages, play, verify highlight + metrics.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { activateTab } from "./activate.mjs";
import { extensionContextOptions } from "./browser.mjs";

const EXT = path.resolve(process.env.EXT || "dist");
const SHOTS = path.resolve("screenshots");
const PROFILE = path.resolve("test/.profile");
const URLS = (process.env.URLS || "https://www.notion.com/blog/steam-steel-and-infinite-minds-ai").split(",");
const LISTEN_SECS = +(process.env.LISTEN_SECS || 25);

const ctx = await chromium.launchPersistentContext(PROFILE, extensionContextOptions(EXT, {
  viewport: { width: 1360, height: 900 },
}));
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
console.log("extension id", sw.url().split("/")[2]);

const report = [];
for (const [n, url] of URLS.entries()) {
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on("console", (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const r = { url }; const tag = process.env.TAG || "";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await activateTab(sw, page);
  const host = page.locator("#listen-later-host");
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.detected, null, { timeout: 30000 });
  r.detectedBlocks = await host.getAttribute("data-detected");
  // snapshot of page integrity before wrapping
  const before = await page.evaluate(() => ({ imgs: document.images.length, links: document.links.length, text: document.body.innerText.replace(/\s+/g, " ").length }));
  await page.screenshot({ path: `${SHOTS}/${tag}${n + 1}-a-player-injected.png` });
  await host.locator("button.play").click();
  const t0 = Date.now();
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.firstAudioMs, null, { timeout: 600000 });
  r.firstAudioMs = +(await host.getAttribute("data-first-audio-ms"));
  r.engine = await host.getAttribute("data-engine");
  r.words = +(await host.getAttribute("data-words")); r.sentences = +(await host.getAttribute("data-sentences"));
  r.prepareMs = +(await host.getAttribute("data-prepare-ms"));
  const after = await page.evaluate(() => ({ imgs: document.images.length, links: document.links.length, text: document.body.innerText.replace(/\s+/g, " ").length, spans: document.querySelectorAll(".ll-w").length }));
  r.integrity = { before, after };
  // watch highlight advance
  const seen = [];
  for (let i = 0; i < LISTEN_SECS * 2; i++) {
    await page.waitForTimeout(500);
    seen.push([await host.getAttribute("data-sentence"), await host.getAttribute("data-word")]);
    if (i === 8) await page.screenshot({ path: `${SHOTS}/${tag}${n + 1}-b-reading-highlight.png` });
  }
  r.distinctWordsHighlighted = new Set(seen.map((s) => s[1])).size;
  r.sentencesReached = Math.max(...seen.map((s) => +s[0]));
  r.rtf = await host.getAttribute("data-rtf"); r.stalls = await host.getAttribute("data-stalls"); r.generated = await host.getAttribute("data-generated");
  // controls: next, pause/resume, click-to-jump, speed
  const s0 = +(await host.getAttribute("data-sentence"));
  await host.locator("button.next").click(); await page.waitForTimeout(300);
  r.nextWorks = +(await host.getAttribute("data-sentence")) === s0 + 1;
  await host.locator("button.play").click(); await page.waitForTimeout(300);
  r.pauseState = await host.getAttribute("data-state");
  const w1 = await host.getAttribute("data-word"); await page.waitForTimeout(1500);
  r.pausedHolds = w1 === (await host.getAttribute("data-word"));
  await host.locator("button.play").click(); await page.waitForTimeout(300);
  r.resumeState = await host.getAttribute("data-state");
  // click a word ~15 sentences ahead (not in a link)
  const target = await page.evaluate(() => { const spans = [...document.querySelectorAll(".ll-w")].filter((s) => !s.closest("a")); const s = spans[Math.min(spans.length - 1, 400)]; s.scrollIntoView({ block: "center" }); return +s.dataset.llw; });
  await page.locator(`.ll-w[data-llw="${target}"]`).first().click();
  await page.waitForFunction(() => document.querySelector("#listen-later-host").dataset.state === "playing", null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  r.clickJumpSentence = +(await host.getAttribute("data-sentence"));
  r.clickJumpWord = +(await host.getAttribute("data-word"));
  await page.screenshot({ path: `${SHOTS}/${tag}${n + 1}-c-click-to-jump.png` });
  await host.locator("select.speed").selectOption("1.5"); await page.waitForTimeout(6000);
  r.afterSpeedState = await host.getAttribute("data-state");
  await host.locator("select.voice").selectOption("am_michael"); await page.waitForTimeout(8000);
  r.afterVoiceState = await host.getAttribute("data-state"); r.afterVoiceWord = await host.getAttribute("data-word");
  await page.screenshot({ path: `${SHOTS}/${tag}${n + 1}-d-voice-menu-michael.png` });
  // close-up of player
  await host.locator(".pill").screenshot({ path: `${SHOTS}/${tag}${n + 1}-e-player-closeup.png` }).catch(() => {});
  r.rtfFinal = await host.getAttribute("data-rtf"); r.generatedFinal = await host.getAttribute("data-generated");
  r.status = await sw.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "status" }));
  r.pageConsoleErrors = errors.length;
  r.extensionConsoleErrors = errors.filter((e) => /chrome-extension:|ListenLater|ll-w|offscreen/i.test(e));
  r.engineErrors = (r.status.errors || []).filter((e) => !/VerifyEachNodeIsAssignedToAnEp/.test(e));
  delete r.status.errors;
  await host.locator("select.voice").selectOption("af_heart"); await host.locator("select.speed").selectOption("1");
  r.llLogs = logs.filter((l) => l.includes("ListenLater"));
  report.push(r);
  console.log(JSON.stringify(r, null, 1));
  await host.locator("button.play").click().catch(() => {});
  await page.close();
}
fs.writeFileSync(`test/report${process.env.TAG || ""}.json`, JSON.stringify(report, null, 1));
await ctx.close();
