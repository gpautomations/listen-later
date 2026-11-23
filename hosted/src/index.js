// SPDX-License-Identifier: GPL-3.0-or-later
// Listen Later hosted tier. Private episode links on Workers + R2.
// Identity v1 is a random per-install secret. Email magic-link sign-in is described in hosted/README.md and is not built.

import { PLAYER_CSS, PLAYER_JS } from "./assets.js";
import { applyCors, cleanEmail, html, HttpError, json, readLimited, sha256Hex, safeEqual, withSecurity } from "./http.js";
import { limitsFromEnv } from "./limits.js";
import { renderEpisode, renderHome, renderMissing } from "./page.js";
import { audioKey, deleteEpisodeObjects, freshId, imageKey, indexEpisode, manifestKey, readManifest, removeEpisode, updateAccount, writeEpisode } from "./store.js";
import { parseEpisode } from "./validate.js";

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{22,128})$/.exec(header);
  return match ? match[1] : "";
}

function rawBearer(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer (\S{8,200})$/.exec(header);
  return match ? match[1] : "";
}

async function accountIdFor(request) {
  const secret = bearer(request);
  if (!secret) throw new HttpError(401, "Sign in from the Listen Later extension is required.");
  return sha256Hex(secret);
}

function episodeUrl(request, id) {
  const origin = new URL(request.url).origin;
  return `${origin}/e/${id}`;
}

function parseByteRange(header, size) {
  if (!header) return null;
  if (header.includes(",")) return { unsatisfiable: true };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return { unsatisfiable: true };
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { unsatisfiable: true };
    const length = Math.min(size, Math.floor(suffix));
    start = size - length;
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start < 0 || start >= size) {
    return { unsatisfiable: true };
  }
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1, end };
}

function audioHeaders(object, size) {
  const headers = new Headers();
  headers.set("accept-ranges", "bytes");
  headers.set("content-type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("cache-control", "private, max-age=3600");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  headers.set("content-length", String(size));
  return headers;
}

async function serveAudio(request, env, id, method) {
  if (!ID_RE.test(id)) return html(404, renderMissing());
  const key = audioKey(id);
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    if (method === "HEAD") {
      const object = await env.EPISODES.head(key);
      if (!object) return html(404, renderMissing());
      return new Response(null, { status: 200, headers: audioHeaders(object, object.size) });
    }
    const object = await env.EPISODES.get(key);
    if (!object) return html(404, renderMissing());
    const headers = audioHeaders(object, object.size);
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && object.httpEtag && ifNoneMatch === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }
  const sized = await env.EPISODES.head(key);
  if (!sized) return html(404, renderMissing());
  const range = parseByteRange(rangeHeader, sized.size);
  if (range?.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${sized.size}`, "accept-ranges": "bytes" },
    });
  }
  const headers = audioHeaders(sized, range.length);
  headers.set("content-range", `bytes ${range.offset}-${range.end}/${sized.size}`);
  if (method === "HEAD") return new Response(null, { status: 206, headers });
  const bodyObj = await env.EPISODES.get(key, { range: { offset: range.offset, length: range.length } });
  if (!bodyObj) return html(404, renderMissing());
  return new Response(bodyObj.body, { status: 206, headers });
}

async function upload(request, env, limits) {
  const accountId = await accountIdFor(request);
  const cap = limits.maxEpisodeBytes + 256 * 1024;
  const bytes = await readLimited(request, cap);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const formReq = new Request(request.url, { method: "POST", headers, body: bytes });
  let form;
  try { form = await formReq.formData(); } catch (e) { throw new HttpError(400, "Upload must be multipart form data."); }
  const episode = await parseEpisode(form, limits);
  const now = new Date();
  const nowIso = now.toISOString();
  const id = await freshId(env.EPISODES);
  const stored = await writeEpisode(env.EPISODES, id, accountId, episode, nowIso);
  try {
    await updateAccount(env.EPISODES, accountId, nowIso, (record) => indexEpisode(record, stored, limits, now.getTime()));
  } catch (err) {
    await deleteEpisodeObjects(env.EPISODES, stored);
    throw err;
  }
  return json(201, {
    id,
    url: episodeUrl(request, id),
    title: stored.title,
    bytes: stored.totalBytes,
    durationSec: stored.durationSec,
  });
}

async function listMine(request, env) {
  const accountId = await accountIdFor(request);
  const obj = await env.EPISODES.get(`accounts/${accountId}.json`);
  const record = obj ? await obj.json() : { episodes: [] };
  const origin = new URL(request.url).origin;
  const episodes = (record.episodes || []).map((episode) => ({
    id: episode.id,
    url: `${origin}/e/${episode.id}`,
    title: episode.title,
    sourceUrl: episode.sourceUrl,
    createdAt: episode.createdAt,
    durationSec: episode.durationSec,
    bytes: episode.bytes,
  }));
  return json(200, { episodes });
}

async function deleteMine(request, env, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, "Episode not found.");
  const accountId = await accountIdFor(request);
  const stored = await readManifest(env.EPISODES, id);
  const indexObj = await env.EPISODES.get(`accounts/${accountId}.json`);
  const index = indexObj ? await indexObj.json() : { episodes: [] };
  const listed = (index.episodes || []).some((episode) => episode.id === id);
  if (stored && stored.accountId !== accountId) throw new HttpError(404, "Episode not found.");
  if (!stored && !listed) throw new HttpError(404, "Episode not found.");
  if (stored) await deleteEpisodeObjects(env.EPISODES, stored);
  if (indexObj) {
    const nowIso = new Date().toISOString();
    await updateAccount(env.EPISODES, accountId, nowIso, (record) => removeEpisode(record, id));
  }
  return json(200, { ok: true, id });
}

async function takedown(request, env) {
  const configured = String(env.ADMIN_TOKEN || "");
  if (!configured) throw new HttpError(404, "Not found.");
  const token = rawBearer(request);
  if (!token || !safeEqual(token, configured)) throw new HttpError(401, "Admin token was not accepted.");
  let body = {};
  try { body = await request.json(); } catch (e) { throw new HttpError(400, "Send the episode id as JSON."); }
  const id = String(body.id || "");
  if (!ID_RE.test(id)) throw new HttpError(400, "Episode id is not valid.");
  const reason = String(body.reason || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 500);
  const stored = await readManifest(env.EPISODES, id);
  await deleteEpisodeObjects(env.EPISODES, stored || { id, images: [] });
  if (stored?.accountId) {
    const nowIso = new Date().toISOString();
    await updateAccount(env.EPISODES, stored.accountId, nowIso, (record) => removeEpisode(record, id));
  }
  await env.EPISODES.put(`takedowns/${id}.json`, JSON.stringify({
    id,
    at: new Date().toISOString(),
    reason,
    hadManifest: !!stored,
  }), { httpMetadata: { contentType: "application/json" } });
  return json(200, { ok: true, id });
}

async function route(request, env) {
  const limits = limitsFromEnv(env);
  const abuseEmail = cleanEmail(env.ABUSE_EMAIL);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS" && path.startsWith("/api/")) return new Response(null, { status: 204 });
  const read = method === "GET" || method === "HEAD";
  if (read && path === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
    });
  }
  if (read && (path === "/sitemap.xml" || path === "/sitemap.txt")) {
    return html(404, renderMissing());
  }
  if (read && path === "/player.css") {
    return new Response(PLAYER_CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" } });
  }
  if (read && path === "/player.js") {
    return new Response(PLAYER_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" } });
  }
  if (read && path === "/") return html(200, renderHome({ abuseEmail }));
  if (method === "GET" && path === "/api/health") return json(200, { ok: true, service: "listen-later-hosted" });

  const episode = /^\/e\/([A-Za-z0-9_-]{22})(\/.*)?$/.exec(path);
  if (episode) {
    const id = episode[1];
    const rest = episode[2] || "";
    if ((method === "GET" || method === "HEAD") && rest === "/audio") return serveAudio(request, env, id, method);
    if (read && rest.startsWith("/i/")) {
      let name = "";
      try { name = decodeURIComponent(rest.slice(3)); } catch (e) { return html(404, renderMissing()); }
      if (!IMAGE_RE.test(name)) return html(404, renderMissing());
      const image = await env.EPISODES.get(imageKey(id, name));
      if (!image) return html(404, renderMissing());
      const headers = new Headers();
      headers.set("content-type", image.httpMetadata?.contentType || "application/octet-stream");
      headers.set("cache-control", "private, max-age=86400");
      headers.set("x-content-type-options", "nosniff");
      return new Response(image.body, { status: 200, headers });
    }
    if (read && rest === "") {
      const stored = await readManifest(env.EPISODES, id);
      if (!stored) return html(404, renderMissing());
      return html(200, renderEpisode(stored, { abuseEmail }));
    }
    return html(404, renderMissing());
  }

  if (path === "/api/episodes" && method === "POST") return upload(request, env, limits);
  if (path === "/api/episodes" && method === "GET") return listMine(request, env);
  const del = /^\/api\/episodes\/([A-Za-z0-9_-]{22})$/.exec(path);
  if (del && method === "DELETE") return deleteMine(request, env, del[1]);
  if (path === "/api/takedown" && method === "POST") return takedown(request, env);

  return html(404, renderMissing());
}

export default {
  async fetch(request, env) {
    const api = new URL(request.url).pathname.startsWith("/api/");
    try {
      let response = await route(request, env);
      if (api) response = applyCors(response, request);
      response = withSecurity(response, { corp: api ? "cross-origin" : "same-origin" });
      if (request.method.toUpperCase() === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
      return response;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : "Something went wrong.";
      let response = json(status, { error: message, code: err instanceof HttpError ? err.code || "" : "" });
      if (api || status === 401 || status === 413 || status === 429) response = applyCors(response, request);
      return withSecurity(response, { corp: "cross-origin" });
    }
  },
};
