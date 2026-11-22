import { chromium } from "playwright";
import fs from "node:fs";
const b = await chromium.launch({ channel: "chromium", headless: true });
const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
await p.goto(process.argv[2], { waitUntil: "networkidle", timeout: 60000 }).catch(e=>console.log(e.message));
await p.addScriptTag({ path: "node_modules/@mozilla/readability/Readability.js" }).catch(e=>console.log("tag",e.message));
await p.addScriptTag({ path: "node_modules/@mozilla/readability/Readability-readerable.js" }).catch(e=>console.log("tag",e.message));
const r = await p.evaluate(() => {
  const out = { title: document.title, pCount: document.querySelectorAll("p").length, h2: [...document.querySelectorAll("h2")].slice(0,8).map(h=>h.textContent.trim().slice(0,60)) };
  try { out.readerable = isProbablyReaderable(document); } catch (e) { out.readerableErr = String(e); }
  try { const a = new Readability(document.cloneNode(true)).parse(); out.art = a && { title: a.title, len: a.length, excerpt: a.textContent.slice(0, 300), content: a.content.slice(0, 1500) }; } catch (e) { out.err = String(e); }
  // big text containers
  out.paras = [...document.querySelectorAll("p")].slice(0, 10).map(p => [p.className.slice(0,60), p.textContent.trim().slice(0, 80), p.getClientRects().length]);
  return out;
});
console.log(JSON.stringify(r, null, 1));
await p.screenshot({ path: "test/probe.png" });
await b.close();
