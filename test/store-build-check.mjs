// Store build check: loads dist-store (or EXT), read-along works, phone button asks for a server when none is set.
import { chromium } from "playwright";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
const EXT = path.resolve(process.env.EXT || "dist-store");
const URL = process.env.URL || "https://en.wikipedia.org/wiki/Steam_engine";
let hits = 0;
const server = http.createServer((q, s) => { hits++; s.writeHead(202, { "Content-Type": "application/json" }); s.end("{}"); });
await new Promise((r) => server.listen(7778, "127.0.0.1", r));
const ctx = await chromium.launchPersistentContext(path.resolve("test/.p-high"), { channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required"] });
const r = {};
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
r.extensionLoaded = !!sw; r.extId = sw.url().split("/")[2];
r.manifest = await sw.evaluate(() => { const m = chrome.runtime.getManifest(); return { version: m.version, permissions: m.permissions, host_permissions: m.host_permissions, optional_host_permissions: m.optional_host_permissions }; });
r.grantedOrigins = (await sw.evaluate(() => chrome.permissions.getAll())).origins;
await sw.evaluate(() => chrome.storage.local.clear());
// chrome://extensions error check (developer mode page lists manifest/runtime errors)
const ext = await ctx.newPage();
await ext.goto("chrome://extensions/?errors=" + r.extId).catch(() => {});
await ext.waitForTimeout(1000);
r.extensionsPageErrorsText = await ext.evaluate(() => { const m = document.querySelector("extensions-manager"); const t = m?.shadowRoot?.textContent || ""; return /error/i.test(t) ? t.slice(0, 300) : "none shown"; }).catch((e) => "n/a: " + e.message);
await ext.close();
const page = await ctx.newPage();
const errors = []; const allLogs = []; page.on("console", (m) => allLogs.push(m.type() + ": " + m.text())); page.on("console", (m) => m.type() === "error" && errors.push(m.text())); page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "domcontentloaded" });
const host = page.locator("#listen-later-host");
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.detected, null, { timeout: 30000 });
r.detectedBlocks = +(await host.getAttribute("data-detected"));
await host.locator("button.play").click();
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.firstAudioMs, null, { timeout: 600000 });
r.firstAudioMs = +(await host.getAttribute("data-first-audio-ms")); r.engine = await host.getAttribute("data-engine");
const seen = new Set(); for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); seen.add(await host.getAttribute("data-word")); }
r.distinctWordsHighlighted = seen.size; r.stalls = (await host.getAttribute("data-stalls")) || "0";
r.phoneTitle = await host.locator("button.phone").getAttribute("title");
// phone with no server configured
await host.locator("button.phone").click();
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.needsServer, null, { timeout: 15000 });
r.noServerToast = await host.getAttribute("data-toast"); r.needs = await host.getAttribute("data-needs-server");
await page.screenshot({ path: "store/test-shots/phone-needs-server.png" });
const optsP = ctx.waitForEvent("page", { timeout: 10000 });
await host.locator(".toast .opts").click();
const opts = await optsP; await opts.waitForLoadState();
r.openSettingsOpens = opts.url();
r.optionsServerField = await opts.inputValue("#server"); r.optionsPlaceholder = await opts.getAttribute("#server", "placeholder");
r.aboutText = (await opts.locator(".about").innerText()).replace(/\s+/g, " ").trim();
r.aboutLinks = await opts.locator(".about a").evaluateAll((as) => as.map((a) => a.href));
r.copyingServed = await opts.evaluate(async () => { const t = await (await fetch("COPYING")).text(); return t.includes("GNU GENERAL PUBLIC LICENSE") && t.includes("Version 3, 29 June 2007"); });
r.thirdPartyServed = await opts.evaluate(async () => (await (await fetch("THIRD_PARTY.md")).text()).includes("eSpeak NG"));
await opts.screenshot({ path: "store/test-shots/options-empty.png", fullPage: true });
// server set but access not granted (headless can't click Chrome's permission prompt) -> asks for permission, sends nothing
await sw.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:7778" }));
await page.bringToFront(); await page.waitForTimeout(6500);
await page.evaluate(() => delete document.querySelector("#listen-later-host").dataset.needsServer);
await host.locator("button.phone").click();
await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.needsServer, null, { timeout: 15000 });
r.noPermissionToast = await host.getAttribute("data-toast"); r.needs2 = await host.getAttribute("data-needs-server");
r.requestsReachedServerWithoutPermission = hits;
r.extensionConsoleErrors = errors.filter((e) => /chrome-extension:|ListenLater|ll-w|offscreen/i.test(e));
console.log(JSON.stringify(r, null, 1));
fs.writeFileSync("store/test-shots/store-build-report.json", JSON.stringify(r, null, 1));
await ctx.close(); server.close();
