// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";
import { sha256Hex } from "../src/http.js";
import { MemoryBucket } from "./memory-bucket.js";

function wavTone(seconds = 0.25, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const write = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  write(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, i % 20 === 0 ? 8000 : 0, true);
  return bytes;
}

function pngPixel() {
  // 1x1 png
  return Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ));
}

function env(over = {}) {
  return {
    EPISODES: new MemoryBucket(),
    ABUSE_EMAIL: "abuse@example.com",
    ADMIN_TOKEN: "test-admin-token",
    ...over,
  };
}

async function call(bucketEnv, path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  let body = opts.body;
  if (opts.json) {
    body = JSON.stringify(opts.json);
    headers.set("content-type", "application/json");
  }
  const request = new Request("https://hosted.test" + path, {
    method: opts.method || "GET",
    headers,
    body,
  });
  return worker.fetch(request, bucketEnv);
}

function auth(secret) {
  return { authorization: `Bearer ${secret}` };
}

function episodeForm({ title = "A short passage", sourceUrl = "https://www.gutenberg.org/ebooks/1342", words, audio, images = [] } = {}) {
  const form = new FormData();
  const blocks = [{
    type: "p",
    words: words || [
      { text: "It", start: 0, end: 0.12 },
      { text: "is", start: 0.12, end: 0.24 },
    ],
  }];
  for (const image of images) blocks.push({ type: "img", name: image.name, alt: image.alt || "picture" });
  form.append("manifest", new Blob([JSON.stringify({
    v: 1,
    title,
    sourceUrl,
    voiceLabel: "Heart",
    durationSec: 0.24,
    blocks,
  })], { type: "application/json" }), "manifest.json");
  form.append("audio", new Blob([audio || wavTone()], { type: "audio/wav" }), "audio.wav");
  for (const image of images) {
    form.append("image", new Blob([image.bytes], { type: image.type }), image.name);
  }
  return form;
}

async function upload(bucketEnv, secret, extra) {
  const form = episodeForm(extra);
  const request = new Request("https://hosted.test/api/episodes", { method: "POST", headers: auth(secret), body: form });
  return worker.fetch(request, bucketEnv);
}

const SECRET_A = "a".repeat(43);
const SECRET_B = "b".repeat(43);

test("robots, home, and health do not list episodes", async () => {
  const live = env();
  const created = await upload(live, SECRET_A, { title: "Secret Title XYZ" });
  assert.equal(created.status, 201);
  const robots = await call(live, "/robots.txt");
  assert.equal(robots.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(await robots.text(), /Disallow: \//);
  const home = await call(live, "/");
  const homeHtml = await home.text();
  assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(homeHtml, /noindex, nofollow/);
  assert.equal(homeHtml.includes("Secret Title XYZ"), false);
  assert.equal(homeHtml.includes("\u2014"), false);
  const health = await call(live, "/api/health");
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(JSON.stringify(healthBody).includes("Secret"), false);
  const sitemap = await call(live, "/sitemap.xml");
  assert.equal(sitemap.status, 404);
});

test("upload, range audio, page safeguards, and owner-only list", async () => {
  const live = env();
  const audio = wavTone();
  const createdRes = await upload(live, SECRET_A, {
    title: 'Pride <script>',
    words: [{ text: 'a<b>', start: 0, end: 0.2 }, { text: "wife.", start: 0.2, end: 0.24 }],
    images: [{ name: "img-1.png", type: "image/png", bytes: pngPixel(), alt: 'pic" onload="alert(1)' }],
  });
  assert.equal(createdRes.status, 201, await createdRes.clone().text());
  const created = await createdRes.json();
  assert.match(created.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(created.url, `https://hosted.test/e/${created.id}`);

  const accountId = await sha256Hex(SECRET_A);
  const page = await call(live, `/e/${created.id}`);
  const markup = await page.text();
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(markup, /noindex, nofollow/);
  assert.match(markup, /Original article/);
  assert.match(markup, /https:\/\/www\.gutenberg\.org\/ebooks\/1342/);
  assert.match(markup, /Report a problem/);
  assert.match(markup, /mailto:abuse@example.com/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /a&lt;b&gt;/);
  assert.equal(markup.includes("<script>alert"), false);
  assert.equal(markup.includes("onload=\"alert"), false);
  assert.match(markup, /<script type="application\/json"/);
  assert.match(markup, /<script src="\/player.js"/);
  assert.equal(markup.includes(accountId), false);
  assert.equal(markup.includes("\u2014"), false);
  assert.match(markup, new RegExp(`src="/e/${created.id}/audio"`));
  assert.match(markup, new RegExp(`src="/e/${created.id}/i/img-1.png"`));
  assert.match(markup, /playsinline/);

  const full = await call(live, `/e/${created.id}/audio`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("content-type"), "audio/wav");
  const fullBytes = new Uint8Array(await full.arrayBuffer());
  assert.equal(Buffer.from(fullBytes).toString("ascii", 0, 4), "RIFF");

  const partial = await call(live, `/e/${created.id}/audio`, { headers: { range: "bytes=0-3" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 0-3/${audio.byteLength}`);
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString("ascii"), "RIFF");

  const tail = await call(live, `/e/${created.id}/audio`, { headers: { range: "bytes=44-45" } });
  assert.equal(tail.status, 206);
  const tailBytes = new Uint8Array(await tail.arrayBuffer());
  assert.equal(tailBytes[0], audio[44]);
  assert.equal(tailBytes[1], audio[45]);

  const badRange = await call(live, `/e/${created.id}/audio`, { headers: { range: "bytes=999999-999999" } });
  assert.equal(badRange.status, 416);

  const head = await call(live, `/e/${created.id}/audio`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), audio.byteLength);
  assert.equal(await head.text(), "");

  const image = await call(live, `/e/${created.id}/i/img-1.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-robots-tag"), "noindex, nofollow");

  const mine = await call(live, "/api/episodes", { headers: auth(SECRET_A) });
  const mineBody = await mine.json();
  assert.equal(mineBody.episodes.length, 1);
  assert.equal(mineBody.episodes[0].title, "Pride <script>");

  const other = await call(live, "/api/episodes", { headers: auth(SECRET_B) });
  assert.equal((await other.json()).episodes.length, 0);
  const stolen = await call(live, `/api/episodes/${created.id}`, { method: "DELETE", headers: auth(SECRET_B) });
  assert.equal(stolen.status, 404);
  const still = await call(live, `/e/${created.id}`);
  assert.equal(still.status, 200);

  const dumped = JSON.stringify([...live.EPISODES.objects.values()].map((obj) => new TextDecoder().decode(obj.bytes)));
  assert.equal(dumped.includes(SECRET_A), false);
});

test("quotas, bad uploads, delete, and takedown", async () => {
  const live = env({ MAX_EPISODES: "1", UPLOADS_PER_HOUR: "2", MAX_EPISODE_BYTES: "5000" });
  const first = await upload(live, SECRET_A);
  assert.equal(first.status, 201, await first.clone().text());
  const id = (await first.clone().json()).id;
  const second = await upload(live, SECRET_A);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).code, "count");

  const javascript = await upload(live, SECRET_B, { sourceUrl: "javascript:alert(1)" });
  assert.equal(javascript.status, 400);

  const huge = await call(live, "/api/episodes", {
    method: "POST",
    headers: { ...auth(SECRET_B), "content-type": "multipart/form-data; boundary=x", "content-length": "999999" },
    body: new Uint8Array([1, 2, 3]),
  });
  assert.equal(huge.status, 413);

  const removed = await call(live, `/api/episodes/${id}`, { method: "DELETE", headers: auth(SECRET_A) });
  assert.equal(removed.status, 200);
  assert.equal((await call(live, `/e/${id}`)).status, 404);
  assert.equal((await (await call(live, "/api/episodes", { headers: auth(SECRET_A) })).json()).episodes.length, 0);

  const again = await upload(live, SECRET_A);
  const againId = (await again.json()).id;
  const denied = await call(live, "/api/takedown", { method: "POST", headers: auth("nope-nope-nope-nope-nope-nope"), json: { id: againId } });
  assert.equal(denied.status, 401);
  const gone = await call(live, "/api/takedown", {
    method: "POST",
    headers: auth("test-admin-token"),
    json: { id: againId, reason: "test takedown" },
  });
  assert.equal(gone.status, 200);
  assert.equal((await call(live, `/e/${againId}`)).status, 404);
  assert.equal((await (await call(live, "/api/episodes", { headers: auth(SECRET_A) })).json()).episodes.length, 0);

  const closed = env({ ADMIN_TOKEN: "" });
  const hidden = await call(closed, "/api/takedown", { method: "POST", headers: auth("test-admin-token"), json: { id: "A".repeat(22) } });
  assert.equal(hidden.status, 404);
});

test("cross-origin episode audio is not embeddable, api allows the extension", async () => {
  const live = env();
  const created = await (await upload(live, SECRET_A)).json();
  const audio = await call(live, `/e/${created.id}/audio`);
  assert.equal(audio.headers.get("cross-origin-resource-policy"), "same-origin");
  const list = await call(live, "/api/episodes", {
    headers: { ...auth(SECRET_A), origin: "chrome-extension://abcdefghijklmnop" },
  });
  assert.equal(list.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");
});
