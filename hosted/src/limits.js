// SPDX-License-Identifier: GPL-3.0-or-later
// Per-account quotas. Defaults are the cheap staging tier. Override with Worker vars.
import { HttpError } from "./http.js";

function num(env, name, fallback) {
  const raw = env?.[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function limitsFromEnv(env) {
  return {
    maxEpisodeBytes: num(env, "MAX_EPISODE_BYTES", 40_000_000),
    maxEpisodes: num(env, "MAX_EPISODES", 25),
    maxAccountBytes: num(env, "MAX_ACCOUNT_BYTES", 250_000_000),
    uploadsPerHour: num(env, "UPLOADS_PER_HOUR", 8),
    maxImages: num(env, "MAX_IMAGES", 20),
    maxImageBytes: num(env, "MAX_IMAGE_BYTES", 1_500_000),
    maxDurationSec: 4 * 60 * 60,
    maxWords: 80_000,
  };
}

export function enforceQuota(record, addBytes, limits, nowMs) {
  const hourAgo = nowMs - 60 * 60 * 1000;
  const recent = (record.uploadTimestamps || []).filter((t) => t >= hourAgo);
  if (recent.length >= limits.uploadsPerHour) {
    throw new HttpError(429, "Too many uploads this hour. Try again later.", "rate");
  }
  if ((record.episodes || []).length >= limits.maxEpisodes) {
    throw new HttpError(429, "This browser already has the maximum number of saved episodes. Delete one first.", "count");
  }
  if ((record.bytesUsed || 0) + addBytes > limits.maxAccountBytes) {
    throw new HttpError(429, "This browser is using the maximum storage. Delete an episode first.", "storage");
  }
  return recent;
}
