// SPDX-License-Identifier: GPL-3.0-or-later
// Account v1: a random secret created on this install and kept in chrome.storage.local.
// The worker stores only a hash of it. A later email magic link can attach this same account.
// See hosted/README.md. This file does not send email.

import { hostPermissionPattern, normalizeBaseUrl } from "./manifest.mjs";

function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getAccountSecret() {
  const { hostedAccountSecret } = await chrome.storage.local.get("hostedAccountSecret");
  if (typeof hostedAccountSecret === "string" && hostedAccountSecret.length >= 43) return hostedAccountSecret;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = bytesToBase64Url(bytes);
  await chrome.storage.local.set({ hostedAccountSecret: secret });
  return secret;
}

export async function configuredBase() {
  const { hostedBaseUrl = "", hostedBaseCleared = false } = await chrome.storage.local.get(["hostedBaseUrl", "hostedBaseCleared"]);
  if (hostedBaseUrl) return normalizeBaseUrl(hostedBaseUrl);
  if (hostedBaseCleared) return "";
  const baked = typeof __HOSTED_BASE__ === "string" ? __HOSTED_BASE__ : "";
  return baked ? normalizeBaseUrl(baked) : "";
}

export async function ensureHostedPermission(baseUrl) {
  const origins = [hostPermissionPattern(baseUrl)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

async function authed(path, options) {
  const base = await configuredBase();
  if (!base) throw new Error("Add a hosted address in Listen Later options first.");
  const secret = await getAccountSecret();
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${secret}`);
  const response = await fetch(base + path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `The hosted service answered ${response.status}.`);
  return body;
}

export async function uploadEpisode(manifest, audio, images) {
  const form = new FormData();
  form.append("manifest", new Blob([JSON.stringify(manifest)], { type: "application/json" }), "manifest.json");
  form.append("audio", new Blob([audio.bytes], { type: audio.mime }), `audio.${audio.ext}`);
  for (const image of images || []) {
    form.append("image", new Blob([image.bytes], { type: image.type }), image.name);
  }
  return authed("/api/episodes", { method: "POST", body: form });
}

export async function listEpisodes() {
  return authed("/api/episodes", { method: "GET" });
}

export async function deleteEpisode(id) {
  return authed(`/api/episodes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function checkHealth(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetch(base + "/api/health");
  if (!response.ok) throw new Error("service answered " + response.status);
  const body = await response.json();
  if (!body?.ok) throw new Error("unexpected answer");
  return body;
}

export { hostPermissionPattern, normalizeBaseUrl };
