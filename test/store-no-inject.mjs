// Store build: nothing is injected until the user turns the page on, and this
// programmatic activate cannot grant activeTab, so the player stays absent.
// Build first: STORE=1 node build.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { requestActivate } from "./activate.mjs";
import { extensionContextOptions } from "./browser.mjs";

const EXT = path.resolve(process.env.EXT || "dist-store");
const html = fs.readFileSync(path.resolve("test/fixture/article.html"));
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const profile = path.resolve("test/.p-store");
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, extensionContextOptions(EXT));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
try {
  const manifest = await sw.evaluate(() => {
    const m = chrome.runtime.getManifest();
    return { version: m.version, hosts: m.host_permissions, content_scripts: m.content_scripts || null };
  });
  if (manifest.version !== "0.2.0") throw new Error("version changed");
  if (manifest.content_scripts) throw new Error("store build still has content_scripts");
  if (manifest.hosts.some((h) => h.startsWith("http://") || h === "<all_urls>")) throw new Error("unexpected host " + manifest.hosts.join(","));
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/article`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await page.locator("#listen-later-host").count()) throw new Error("store build injected on load");
  const activated = await requestActivate(sw, page);
  if (activated?.ok) throw new Error("store build injected without a user gesture or host permission");
  if (await page.locator("#listen-later-host").count()) throw new Error("player appeared after a denied activate");
  console.log(JSON.stringify({ manifest, activated, playerOnLoad: 0 }));
} finally {
  await ctx.close();
  server.close();
}
