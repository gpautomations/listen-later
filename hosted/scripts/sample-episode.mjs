// SPDX-License-Identifier: GPL-3.0-or-later
// Build a short public-domain episode (Pride and Prejudice, Project Gutenberg ebook 1342).
// Word timings come from speaking each word with espeak-ng and concatenating the audio.
//   node hosted/scripts/sample-episode.mjs
//   HOSTED_BASE_URL=http://127.0.0.1:8787 HOSTED_SECRET=... node hosted/scripts/sample-episode.mjs --upload

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SENTENCES = [
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
  "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
];

const SOURCE = "https://www.gutenberg.org/ebooks/1342";
const TITLE = "Pride and Prejudice, Chapter 1 (excerpt)";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function readPcm(file) {
  const bytes = readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF") throw new Error("espeak did not write a wav");
  const rate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const bits = view.getUint16(34, true);
  if (channels !== 1 || bits !== 16) throw new Error("expected 16-bit mono");
  return { rate, pcm: bytes.subarray(44) };
}

function silence(rate, seconds) {
  return Buffer.alloc(Math.round(rate * seconds) * 2);
}

function wavFile(pcm, rate) {
  const bytes = Buffer.alloc(44 + pcm.length);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + pcm.length, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(pcm.length, 40);
  pcm.copy(bytes, 44);
  return bytes;
}

export function buildSample() {
  const dir = mkdtempSync(path.join(tmpdir(), "ll-sample-"));
  try {
    const words = [];
    const pcmParts = [];
    let rate = 0;
    let cursor = 0;
    SENTENCES.forEach((sentence, sIndex) => {
      const parts = sentence.split(/\s+/);
      parts.forEach((text, wIndex) => {
        const file = path.join(dir, `w-${sIndex}-${wIndex}.wav`);
        run("espeak-ng", ["-v", "en-us", "-s", "150", "-w", file, text]);
        const wav = readPcm(file);
        if (!rate) rate = wav.rate;
        if (wav.rate !== rate) throw new Error("sample rate changed");
        const start = cursor / rate;
        pcmParts.push(wav.pcm);
        cursor += wav.pcm.length / 2;
        const end = cursor / rate;
        words.push({ text, start, end });
        const gap = /[.!?]$/.test(text) ? 0.28 : 0.06;
        pcmParts.push(silence(rate, gap));
        cursor += Math.round(rate * gap);
      });
    });
    const pcm = Buffer.concat(pcmParts);
    const wav = wavFile(pcm, rate);
    const wavPath = path.join(dir, "episode.wav");
    const webmPath = path.join(dir, "episode.webm");
    writeFileSync(wavPath, wav);
    run("ffmpeg", ["-y", "-i", wavPath, "-c:a", "libopus", "-b:a", "24k", "-vn", "-f", "webm", webmPath]);
    const probed = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", webmPath]).trim());
    if (!Number.isFinite(probed) || probed <= 0) throw new Error("could not read the opus duration");
    const wavDuration = cursor / rate;
    const scale = probed > 0 && wavDuration > 0 ? probed / wavDuration : 1;
    const scaled = words.map((word) => ({
      text: word.text,
      start: Math.round(word.start * scale * 1000) / 1000,
      end: Math.round(word.end * scale * 1000) / 1000,
    }));
    const audio = readFileSync(webmPath);
    return {
      manifest: {
        v: 1,
        title: TITLE,
        sourceUrl: SOURCE,
        voiceLabel: "espeak-ng (sample, not Kokoro)",
        durationSec: Math.round(probed * 1000) / 1000,
        blocks: [{ type: "p", words: scaled }],
      },
      audio,
      mime: "audio/webm",
      filename: "audio.webm",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function upload(sample, base, secret) {
  const form = new FormData();
  form.append("manifest", new Blob([JSON.stringify(sample.manifest)], { type: "application/json" }), "manifest.json");
  form.append("audio", new Blob([sample.audio], { type: sample.mime }), sample.filename);
  const response = await fetch(base.replace(/\/+$/, "") + "/api/episodes", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `upload failed (${response.status})`);
  return body;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sample = buildSample();
  console.log(JSON.stringify({
    title: sample.manifest.title,
    source: sample.manifest.sourceUrl,
    seconds: sample.manifest.durationSec,
    words: sample.manifest.blocks[0].words.length,
    audioBytes: sample.audio.byteLength,
  }));
  if (process.argv.includes("--upload")) {
    const base = process.env.HOSTED_BASE_URL || "";
    const secret = process.env.HOSTED_SECRET || "";
    if (!base || secret.length < 22) throw new Error("HOSTED_BASE_URL and HOSTED_SECRET are required to upload");
    const result = await upload(sample, base, secret);
    console.log(result.url);
  }
}
