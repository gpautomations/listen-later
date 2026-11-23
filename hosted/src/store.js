// SPDX-License-Identifier: GPL-3.0-or-later
// R2 layout:
//   accounts/<sha256>.json          private index for one install secret
//   episodes/<id>/manifest.json     text, timings, owner id (never sent to the browser)
//   episodes/<id>/audio             bytes served with Range
//   episodes/<id>/images/<name>
// Email magic-link fields are reserved on the account record and unused.

import { HttpError, randomId } from "./http.js";
import { enforceQuota } from "./limits.js";

export function accountKey(accountId) {
  return `accounts/${accountId}.json`;
}
export function manifestKey(id) {
  return `episodes/${id}/manifest.json`;
}
export function audioKey(id) {
  return `episodes/${id}/audio`;
}
export function imageKey(id, name) {
  return `episodes/${id}/images/${name}`;
}

function newAccount(accountId, nowIso) {
  return {
    v: 1,
    accountId,
    createdAt: nowIso,
    updatedAt: nowIso,
    bytesUsed: 0,
    episodes: [],
    uploadTimestamps: [],
    // Reserved for a later email magic-link sign-in. Not written by v1.
    email: null,
    emailVerifiedAt: null,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bareEtag(value) {
  return String(value || "").replace(/^W\//, "").replaceAll('"', "");
}

export async function updateAccount(bucket, accountId, nowIso, mutate) {
  const key = accountKey(accountId);
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const existing = await bucket.get(key);
    const record = existing ? await existing.json() : newAccount(accountId, nowIso);
    const next = await mutate(clone(record));
    const etag = bareEtag(existing?.httpEtag);
    try {
      await bucket.put(key, JSON.stringify(next), {
        httpMetadata: { contentType: "application/json" },
        onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
      });
      return next;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const retry = err?.name === "PreconditionFailed" || /precondition/i.test(String(err?.message || err));
      if (!retry) {
        console.error("account index write failed", err?.name || "", err?.message || err);
        throw err;
      }
      lastErr = err;
    }
  }
  throw lastErr || new HttpError(500, "Could not save the account.");
}

export async function freshId(bucket) {
  for (let i = 0; i < 5; i++) {
    const id = randomId();
    const hit = await bucket.head(manifestKey(id));
    if (!hit) return id;
  }
  throw new HttpError(500, "Could not allocate an id.");
}

async function putBytes(bucket, key, bytes, contentType) {
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
}

export async function writeEpisode(bucket, id, accountId, episode, nowIso) {
  const stored = {
    v: 1,
    id,
    accountId,
    title: episode.title,
    sourceUrl: episode.sourceUrl,
    voiceLabel: episode.voiceLabel,
    durationSec: episode.durationSec,
    audioType: episode.audio.type,
    audioBytes: episode.audio.bytes.byteLength,
    totalBytes: episode.totalBytes,
    blocks: episode.blocks,
    images: episode.images.map((image) => ({
      name: image.name,
      type: image.type,
      alt: image.alt,
      bytes: image.bytes,
    })),
    createdAt: nowIso,
  };
  await putBytes(bucket, audioKey(id), episode.audio.bytes, episode.audio.type);
  for (const image of episode.images) {
    await putBytes(bucket, imageKey(id, image.name), image.data, image.type);
  }
  await putBytes(bucket, manifestKey(id), new TextEncoder().encode(JSON.stringify(stored)), "application/json");
  return stored;
}

export async function deleteEpisodeObjects(bucket, stored) {
  if (!stored?.id) return;
  await bucket.delete(audioKey(stored.id));
  await bucket.delete(manifestKey(stored.id));
  for (const image of stored.images || []) await bucket.delete(imageKey(stored.id, image.name));
}

export async function readManifest(bucket, id) {
  const obj = await bucket.get(manifestKey(id));
  if (!obj) return null;
  return obj.json();
}

export function indexEpisode(record, stored, limits, nowMs) {
  const recent = enforceQuota(record, stored.totalBytes, limits, nowMs);
  recent.push(nowMs);
  record.uploadTimestamps = recent;
  record.bytesUsed = (record.bytesUsed || 0) + stored.totalBytes;
  record.episodes = record.episodes || [];
  record.episodes.push({
    id: stored.id,
    title: stored.title,
    sourceUrl: stored.sourceUrl,
    createdAt: stored.createdAt,
    durationSec: stored.durationSec,
    bytes: stored.totalBytes,
    audioType: stored.audioType,
  });
  record.updatedAt = stored.createdAt;
  return record;
}

export function removeEpisode(record, id) {
  const found = (record.episodes || []).find((episode) => episode.id === id);
  record.episodes = (record.episodes || []).filter((episode) => episode.id !== id);
  if (found) record.bytesUsed = Math.max(0, (record.bytesUsed || 0) - (found.bytes || 0));
  record.updatedAt = new Date().toISOString();
  return record;
}
