// Checks the staging build shows Save and get link only when a hosted address is set.
// Build first: HOSTED_BASE_URL=https://listen-later-hosted-staging.scott-408.workers.dev node build.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { activateTab } from "./activate.mjs";
import { extensionContextOptions } from "./browser.mjs";

const EXT = path.resolve(process.env.EXT || "dist");
const EXPECTED = "https://listen-later-hosted-staging.scott-408.workers.dev";
const html = fs.readFileSync(path.resolve("test/fixture/article.html"));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
fs.rmSync(path.resolve("test/.p-hosted"), { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(path.resolve("test/.p-hosted"), extensionContextOptions(EXT, {
  viewport: { width: 1100, height: 800 },
}));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
const report = {};
try {
  const id = sw.url().split("/")[2];
  const options = await ctx.newPage();
  const errors = [];
  options.on("pageerror", (e) => errors.push(e.message));
  await options.goto(`chrome-extension://${id}/options.html`, { waitUntil: "domcontentloaded" });
  await options.locator("#hosted-base").waitFor();
  report.address = await options.locator("#hosted-base").inputValue();
  report.heading = await options.locator("#hosted-section h2").first().innerText();
  report.listHeading = await options.locator("#hosted-section h2").nth(1).innerText();
  if (report.address !== EXPECTED) throw new Error("hosted address " + report.address);
  if (report.heading !== "Save and get link") throw new Error(report.heading);
  if (report.listHeading !== "My saved episodes") throw new Error(report.listHeading);
  report.listNote = await options.locator("#hosted-list li").innerText();
  if (!report.listNote.includes("Press Save")) throw new Error(report.listNote);
  if (errors.length) throw new Error(errors.join("\n"));

  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("page " + e.message));
  await page.goto(origin + "/a", { waitUntil: "domcontentloaded" });
  await activateTab(sw, page);
  const host = page.locator("#listen-later-host");
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.style.display === "block", null, { timeout: 10000 });
  const button = host.locator("button.hosted");
  report.label = await button.getAttribute("aria-label");
  report.hiddenWhenConfigured = await button.evaluate((el) => el.hidden);
  report.saveStillThere = await host.locator("button.save").getAttribute("aria-label");
  if (report.label !== "Save and get link") throw new Error(report.label);
  if (report.hiddenWhenConfigured) throw new Error("link button stayed hidden");
  if (report.saveStillThere !== "Save episode") throw new Error("save button changed");

  await sw.evaluate(() => chrome.storage.local.set({ hostedBaseCleared: true }));
  await page.waitForFunction(() => {
    const root = document.querySelector("#listen-later-host")?.shadowRoot;
    return root?.querySelector("button.hosted")?.hidden === true;
  }, null, { timeout: 5000 });
  report.hiddenAfterClear = true;
  await sw.evaluate(() => chrome.storage.local.set({ hostedBaseCleared: false }));
  await page.waitForFunction(() => {
    const root = document.querySelector("#listen-later-host")?.shadowRoot;
    return root?.querySelector("button.hosted")?.hidden === false;
  }, null, { timeout: 5000 });
  report.visibleAgain = true;
  if (errors.length) throw new Error(errors.join("\n"));
  await page.screenshot({ path: "/opt/cursor/artifacts/extension-player.png" });
  await options.screenshot({ path: "/opt/cursor/artifacts/extension-options.png", fullPage: true });
} finally {
  await ctx.close();
  server.close();
}
console.log(JSON.stringify(report, null, 2));
