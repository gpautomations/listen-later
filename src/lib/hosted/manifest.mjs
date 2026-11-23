// SPDX-License-Identifier: GPL-3.0-or-later
// Episode document uploaded to the hosted tier. Same text, timings, and media as a saved episode,
// split so the phone page can stream the audio instead of hiding it inside one HTML file.

export function normalizeBaseUrl(raw) {
  const u = new URL(String(raw || "").trim());
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("use an https address");
  return u.origin;
}

export function hostPermissionPattern(baseUrl) {
  const u = new URL(baseUrl);
  let host = u.hostname;
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `${u.protocol}//${host}/*`;
}

export function buildManifest({ title, sourceUrl, voiceLabel, durationSec, blocks }) {
  return {
    v: 1,
    title: title || "Article",
    sourceUrl,
    voiceLabel: voiceLabel || "",
    durationSec,
    blocks,
  };
}
