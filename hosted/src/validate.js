// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the episode bundle before anything is stored.
import { HttpError } from "./http.js";

const AUDIO_TYPES = new Map([
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/opus", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "mp4"],
  ["audio/m4a", "mp4"],
]);

const CANONICAL_AUDIO = {
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
};

const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

function sniffAudio(bytes) {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "wav";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") return "mp4";
  return "";
}

function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "image/png";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return "";
}

function ascii(bytes, start, end) {
  let s = "";
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function plainText(value, max) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (text.length > max) throw new HttpError(400, "A text field is too long.");
  return text;
}

function httpUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch (e) { throw new HttpError(400, "The episode needs a link to the original article."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "The original article link must be an http or https address.");
  if (url.href.length > 2000) throw new HttpError(400, "The original article link is too long.");
  url.username = "";
  url.password = "";
  return url.href;
}

function mimeOf(part, fallback) {
  const raw = (part && typeof part.type === "string" && part.type) || fallback || "";
  return raw.split(";")[0].trim().toLowerCase();
}

async function asBytes(part) {
  if (part == null) return null;
  if (typeof part === "string") return new TextEncoder().encode(part);
  return new Uint8Array(await part.arrayBuffer());
}

function wordList(words, limits, state) {
  if (!Array.isArray(words) || !words.length) throw new HttpError(400, "A paragraph has no words.");
  if (words.length > 4000) throw new HttpError(400, "A paragraph is too long.");
  const out = [];
  for (const word of words) {
    state.words += 1;
    if (state.words > limits.maxWords) throw new HttpError(400, "That article is too long to host.");
    const text = plainText(word?.text, 500);
    if (!text) throw new HttpError(400, "A word is empty.");
    const start = Number(word?.start);
    const end = Number(word?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new HttpError(400, "Word timings are not usable.");
    }
    if (end > limits.maxDurationSec + 1) throw new HttpError(400, "That episode is longer than the maximum.");
    let startOut = round3(start);
    let endOut = round3(end);
    if (endOut < startOut) endOut = startOut;
    state.maxEnd = Math.max(state.maxEnd, endOut);
    out.push({ text, start: startOut, end: endOut });
  }
  return out;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function imageName(name) {
  const base = String(name || "").split(/[/\\]/).pop();
  if (!base || base.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(base)) {
    throw new HttpError(400, "An image name is not allowed.");
  }
  return base;
}

export async function parseEpisode(form, limits) {
  const manifestPart = form.get("manifest");
  if (!manifestPart) throw new HttpError(400, "The upload needs a manifest.");
  const manifestBytes = await asBytes(manifestPart);
  if (manifestBytes.byteLength > 2_000_000) throw new HttpError(400, "The manifest is too large.");
  let raw;
  try { raw = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch (e) { throw new HttpError(400, "The manifest is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "The manifest is not valid JSON.");

  const title = plainText(raw.title, 300) || "Untitled article";
  const sourceUrl = httpUrl(raw.sourceUrl);
  const voiceLabel = plainText(raw.voiceLabel, 80);
  const blocksIn = Array.isArray(raw.blocks) ? raw.blocks : [];
  if (!blocksIn.length) throw new HttpError(400, "The episode has no article text.");
  if (blocksIn.length > 8000) throw new HttpError(400, "That article is too long to host.");

  const state = { words: 0, maxEnd: 0 };
  const blocks = [];
  const imageRefs = [];
  for (const block of blocksIn) {
    if (Array.isArray(block)) {
      blocks.push({ type: "p", words: wordList(block, limits, state) });
      continue;
    }
    if (block?.type === "p" || Array.isArray(block?.words)) {
      blocks.push({ type: "p", words: wordList(block.words, limits, state) });
      continue;
    }
    if (block?.type === "img") {
      const name = imageName(block.name);
      imageRefs.push(name);
      blocks.push({ type: "img", name, alt: plainText(block.alt, 300) });
      continue;
    }
    throw new HttpError(400, "A block in the episode is not a paragraph or an image.");
  }
  if (!state.words) throw new HttpError(400, "The episode has no article text.");

  let durationSec = Number(raw.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < 0) durationSec = state.maxEnd;
  durationSec = Math.max(durationSec, state.maxEnd);
  if (durationSec > limits.maxDurationSec) throw new HttpError(400, "That episode is longer than the maximum.");
  durationSec = round3(durationSec);

  const audioPart = form.get("audio");
  if (!audioPart || typeof audioPart === "string") throw new HttpError(400, "The upload needs an audio file.");
  const audioBytes = await asBytes(audioPart);
  if (!audioBytes.byteLength) throw new HttpError(400, "The audio file is empty.");
  const declared = AUDIO_TYPES.get(mimeOf(audioPart, raw.audioType));
  const sniffed = sniffAudio(audioBytes);
  if (!sniffed) throw new HttpError(400, "The audio file is not a supported type.");
  if (declared && declared !== sniffed) throw new HttpError(400, "The audio file does not match its type.");
  const audioType = CANONICAL_AUDIO[sniffed];

  const imageParts = form.getAll("image").filter((part) => part && typeof part !== "string");
  if (imageParts.length > limits.maxImages) throw new HttpError(400, "Too many images.");
  const images = [];
  const byName = new Map();
  for (const part of imageParts) {
    const bytes = await asBytes(part);
    if (bytes.byteLength > limits.maxImageBytes) throw new HttpError(400, "An image is too large.");
    const sniffedType = sniffImage(bytes);
    if (!sniffedType) throw new HttpError(400, "An image is not a jpeg, png, gif, or webp.");
    const declaredType = mimeOf(part, "");
    if (declaredType && IMAGE_TYPES.has(declaredType) && declaredType !== sniffedType) {
      throw new HttpError(400, "An image does not match its type.");
    }
    const name = imageName(part.name || "");
    if (byName.has(name)) throw new HttpError(400, "Two images use the same name.");
    const image = { name, type: sniffedType, alt: "", bytes: bytes.byteLength, data: bytes };
    byName.set(name, image);
    images.push(image);
  }
  for (const name of imageRefs) {
    if (!byName.has(name)) throw new HttpError(400, "The article refers to an image that was not uploaded.");
  }
  for (const image of images) {
    if (!imageRefs.includes(image.name)) throw new HttpError(400, "An uploaded image is not used in the article.");
    const block = blocks.find((item) => item.type === "img" && item.name === image.name);
    image.alt = block?.alt || "";
  }

  let totalBytes = manifestBytes.byteLength + audioBytes.byteLength;
  for (const image of images) totalBytes += image.bytes;
  if (totalBytes > limits.maxEpisodeBytes) throw new HttpError(413, "That episode is too large.");

  return {
    title,
    sourceUrl,
    voiceLabel,
    durationSec,
    blocks,
    audio: { bytes: audioBytes, type: audioType },
    images,
    totalBytes,
  };
}
