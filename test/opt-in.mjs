// Proves the player is absent until activation, then appears, and a pinned site injects on the next visit.
// Build first: EXTRA_HOST_PERMISSIONS='http://127.0.0.1/*' node build.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { activateTab } from "./activate.mjs";
import { extensionContextOptions } from "./browser.mjs";

const EXT = path.resolve(process.env.EXT || "dist");
const html = fs.readFileSync(path.resolve("test/fixture/article.html"));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
fs.rmSync(path.resolve("test/.p-optin"), { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(path.resolve("test/.p-optin"), extensionContextOptions(EXT, {
  viewport: { width: 1100, height: 800 },
}));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
const report = {};
try {
  report.manifest = await sw.evaluate(() => {
    const m = chrome.runtime.getManifest();
    return {
      version: m.version,
      permissions: m.permissions,
      host_permissions: m.host_permissions,
      content_scripts: m.content_scripts || null,
      commands: Object.keys(m.commands || {}),
    };
  });
  if (report.manifest.content_scripts) throw new Error("content_scripts still in the built manifest");
  if (report.manifest.version !== "0.2.0") throw new Error("version changed");
  if (!report.manifest.permissions.includes("activeTab")) throw new Error("activeTab missing");

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(origin + "/a", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  report.playerOnLoad = await page.locator("#listen-later-host").count();
  if (report.playerOnLoad !== 0) throw new Error("player was injected before the user turned Listen Later on");

  report.activate = await activateTab(sw, page);
  const host = page.locator("#listen-later-host");
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.style.display === "block", null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.detected, null, { timeout: 10000 });
  report.detected = await host.getAttribute("data-detected");
  report.saveLabel = await host.locator("button.save").getAttribute("aria-label");
  report.saveTitle = await host.locator("button.save").getAttribute("title");
  report.shareCount = await host.locator("button.share").count();
  if (report.saveLabel !== "Save episode") throw new Error("save button missing: " + report.saveLabel);
  if (report.shareCount !== 0) throw new Error("share button still present");
  if (!report.manifest.permissions.includes("downloads")) throw new Error("downloads permission missing");
  await host.locator("button.save").click();
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.savePhase === "confirm", null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.saveImages != null, null, { timeout: 8000 });
  report.saveEstimate = await host.locator(".save-estimate").innerText();
  report.saveImages = await host.getAttribute("data-save-images");
  report.saveImageBytes = Number(await host.getAttribute("data-save-image-bytes"));
  report.driveHidden = await host.locator("button.drive").evaluate((el) => el.hidden);
  if (!/File about/.test(report.saveEstimate)) throw new Error("estimate missing: " + report.saveEstimate);
  if (report.saveImages !== "1") throw new Error("expected one article picture, got " + report.saveImages);
  if (!(report.saveImageBytes > 100)) throw new Error("picture bytes missing from the estimate");
  if (!/Including/.test(report.saveEstimate)) throw new Error("estimate omitted pictures: " + report.saveEstimate);
  if (!report.driveHidden) throw new Error("Drive button is visible without a client id");
  await host.locator(".savebox .stop").click();
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.savePhase === "cancelled", null, { timeout: 5000 });

  report.secondClick = await activateTab(sw, page);
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.style.display === "none", null, { timeout: 5000 });
  report.hidden = true;
  await activateTab(sw, page);
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.style.display === "block", null, { timeout: 5000 });

  const grantP = ctx.waitForEvent("page", { timeout: 10000 });
  await host.locator("button.gear").click();
  await host.locator("button.always").click();
  const grant = await grantP;
  await grant.waitForLoadState("domcontentloaded");
  report.grantUrl = grant.url();
  if (!report.grantUrl.includes("grant.html")) throw new Error("confirmation tab was " + report.grantUrl);
  await grant.click("#allow");
  await page.waitForFunction(() => document.querySelector("#listen-later-host")?.dataset.alwaysOn === "true", null, { timeout: 10000 });
  report.alwaysOn = true;

  const pageB = await ctx.newPage();
  await pageB.goto(origin + "/b", { waitUntil: "domcontentloaded" });
  await pageB.waitForFunction(() => {
    const el = document.querySelector("#listen-later-host");
    return el && el.dataset.detected && el.style.display === "block";
  }, null, { timeout: 10000 });
  report.pinnedSiteInjected = true;
  report.extensionErrors = errors.filter((e) => /ListenLater|content\.js|chrome-extension/i.test(e));
  if (report.extensionErrors.length) throw new Error(report.extensionErrors.join(" | "));
  console.log(JSON.stringify(report, null, 1));
} finally {
  await ctx.close();
  server.close();
}
