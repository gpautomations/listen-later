import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chromium", headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const r = await p.goto("https://quiet-cedar-ulkb.agentpub.io/", { waitUntil: "networkidle" });
console.log(r.status(), await p.title(), await p.locator("h1").textContent(), await p.evaluate(() => document.querySelector('meta[name=robots]')?.content));
await p.screenshot({ path: "/workspace/listen-later-ext/store/test-shots/privacy-policy-live.png", fullPage: false });
await b.close();
