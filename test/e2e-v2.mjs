// v2 E2E: quality modes, Send to my phone (mock Listen Later server), share link + #listen-later invite.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
// Server host the build was configured with (local.config.json "defaultServer"); mapped to a mock on 127.0.0.1.
const TEST_HOST = process.env.LL_TEST_HOST || "my-computer.local";

const EXT = path.resolve(process.env.EXT || "dist");
const SHOTS = path.resolve("screenshots");
const PROFILE = path.resolve(process.env.PROFILE || "test/.profile");
const URL = process.env.URL || "https://www.notion.com/blog/steam-steel-and-infinite-minds-ai";
const QUALITY = process.env.QUALITY || "high";
const TAG = process.env.TAG || `v2-${QUALITY}-`;
const LISTEN_SECS = +(process.env.LISTEN_SECS || 30);
const EXTRA = process.env.EXTRA !== "0";

// Mock of a Listen Later server: records POST /api/ingest bodies, answers like app.py (202).
const received = [];
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/api/ingest") {
      received.push({ headers: req.headers, body: JSON.parse(body) });
      res.writeHead(202, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "mock123", title: JSON.parse(body).title, status: "queued" }));
    } else if (req.url === "/api/items") { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); }
    else { res.writeHead(404); res.end(); }
  });
});
await new Promise((r) => server.listen(7778, "127.0.0.1", r));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required",
    `--host-resolver-rules=MAP ${TEST_HOST.toLowerCase()} 127.0.0.1`],
});
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
await sw.evaluate(([q, h]) => chrome.storage.local.set({ quality: q, voice: "af_heart", speed: 1, serverUrl: `http://${h}:7778` }), [QUALITY, TEST_HOST]);

const r = { url: URL, quality: QUALITY };
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
const host = page.locator("#listen-later-host");
const attr = (k) => host.getAttribute("data-" + k);
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.detected, null, { timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/${TAG}a-player.png` });
await host.locator("button.play").click();
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.firstAudioMs, null, { timeout: 600000 });
r.firstAudioMs = +(await attr("first-audio-ms"));
r.engine = await attr("engine"); r.ctxRate = await attr("ctx-rate");
const seen = new Set(); let stallsBefore = await attr("stalls");
for (let i = 0; i < LISTEN_SECS * 2; i++) { await page.waitForTimeout(500); seen.add(await attr("word")); if (i === 8) await page.screenshot({ path: `${SHOTS}/${TAG}b-highlight.png` }); }
r.distinctWordsHighlighted = seen.size; r.sentenceReached = +(await attr("sentence"));
r.rtf = await attr("rtf"); r.generated = await attr("generated"); r.stalls = (await attr("stalls")) || "0"; r.peak = await attr("peak");

if (EXTRA) {
  // settings popover
  await host.locator("button.gear").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${TAG}c-settings.png` });
  await host.locator("button.gear").click();
  // Send to my phone -> mock server
  await host.locator("button.phone").click();
  await page.waitForFunction(() => /^(ok: Sent|err:)/.test(document.querySelector("#listen-later-host").dataset.toast || ""), null, { timeout: 30000 });
  r.sendToast = await attr("toast");
  await page.screenshot({ path: `${SHOTS}/${TAG}d-sent-toast.png` });
  const p = received[0]?.body;
  r.sendPayload = p && { title: p.title, source_url: p.source_url, chapters: p.chapters.map((c) => ({ title: c.title, chars: c.text.length, starts: c.text.slice(0, 60) })), contentType: received[0].headers["content-type"], origin: received[0].headers.origin || null };
  if (p) fs.writeFileSync("test/sent-payload.json", JSON.stringify(p, null, 1));
  // failure path: nothing listening on 7799
  await sw.evaluate((h) => chrome.storage.local.set({ serverUrl: `http://${h}:7799` }), TEST_HOST);
  await page.waitForTimeout(6500);
  await host.locator("button.phone").click();
  await page.waitForFunction(() => /^err:/.test(document.querySelector("#listen-later-host").dataset.toast || ""), null, { timeout: 30000 });
  r.sendFailToast = await attr("toast");
  await page.screenshot({ path: `${SHOTS}/${TAG}e-send-failed-toast.png` });
  await sw.evaluate((h) => chrome.storage.local.set({ serverUrl: `http://${h}:7778` }), TEST_HOST);
  // Share listen link
  await host.locator("button.play").click(); // pause
  await page.waitForTimeout(6500);
  await host.locator("button.share").click();
  await page.waitForTimeout(500);
  r.shareText = await attr("share-text");
  r.clipboard = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => "clipboard read failed: " + e.message);
  await page.screenshot({ path: `${SHOTS}/${TAG}f-share-copied.png` });
  // open the shared link in a new tab -> invite + one-click play
  const link = r.shareText.split("\n").pop();
  const p2 = await ctx.newPage();
  await p2.goto(link, { waitUntil: "domcontentloaded" });
  await p2.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.invite, null, { timeout: 30000 });
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: `${SHOTS}/${TAG}g-shared-link-invite.png` });
  const t0 = Date.now();
  await p2.locator("#listen-later-host .invite .big").click();
  await p2.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.firstAudioMs, null, { timeout: 120000 });
  r.sharedLinkFirstAudioMs = +(await p2.locator("#listen-later-host").getAttribute("data-first-audio-ms"));
  r.sharedLinkServerSawFragment = false; // fragments are never sent in HTTP requests (browser behaviour)
  await p2.close();
}
r.extensionConsoleErrors = errors.filter((e) => /chrome-extension:|ListenLater|ll-w|offscreen/i.test(e));
const st = await sw.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "status" }));
r.engineStatus = { ...st, errors: (st.errors || []).filter((e) => !/VerifyEachNodeIsAssignedToAnEp/.test(e)) };
console.log(JSON.stringify(r, null, 1));
fs.writeFileSync(`test/report-${TAG}.json`, JSON.stringify(r, null, 1));
await ctx.close(); server.close();
