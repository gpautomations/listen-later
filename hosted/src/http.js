// SPDX-License-Identifier: GPL-3.0-or-later
// Shared HTTP helpers. Every response is marked noindex. Episode pages are not a public catalog.

export class HttpError extends Error {
  constructor(status, error, code) {
    super(error);
    this.name = "HttpError";
    this.status = status;
    this.code = code || "";
  }
}

export function base64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a, b) {
  const aa = new TextEncoder().encode(String(a ?? ""));
  const bb = new TextEncoder().encode(String(b ?? ""));
  const n = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export function json(status, body, extraHeaders) {
  const headers = new Headers(extraHeaders || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export function html(status, markup, extraHeaders) {
  const headers = new Headers(extraHeaders || {});
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  return new Response(markup, { status, headers });
}

const ROBOTS = "noindex, nofollow";

export function withSecurity(response, { corp } = {}) {
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", ROBOTS);
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "browsing-topics=(), interest-cohort=()");
  if (corp) headers.set("cross-origin-resource-policy", corp);
  if (!headers.has("content-security-policy") && (response.headers.get("content-type") || "").includes("text/html")) {
    headers.set("content-security-policy", [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "media-src 'self'",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function corsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  let ok = false;
  if (origin.startsWith("chrome-extension://")) ok = true;
  else {
    try { ok = origin === new URL(request.url).origin; } catch (e) { ok = false; }
  }
  if (!ok) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export function applyCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function cleanEmail(value) {
  const v = String(value || "").trim();
  if (v.length > 80) return "abuse@example.com";
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) return "abuse@example.com";
  return v;
}

export async function readLimited(request, maxBytes) {
  const declared = request.headers.get("content-length");
  if (declared != null && declared !== "") {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "Upload size is missing.");
    if (n > maxBytes) throw new HttpError(413, "That episode is too large.");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (e) { /* already over the cap */ }
      throw new HttpError(413, "That episode is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
