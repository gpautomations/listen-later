// SPDX-License-Identifier: GPL-3.0-or-later
// Pack Kokoro's Float32 PCM into an Opus-in-WebM file for Save episode.
// Word timings stay on the original PCM clock (seconds). Resampling 24 kHz to 48 kHz
// keeps that duration, and the WebM CodecDelay matches the Opus pre-skip so playback
// currentTime lines up with those seconds. WAV is only used when Opus cannot be encoded.
import { encodeWav } from "./episode.mjs";

export const OPUS_BITRATE = 24000;
const FRAME = 960; // 20 ms at 48 kHz, the Opus frame size Chrome's encoder expects
// Chrome's Opus encoder delays the waveform by about one extra frame past the OpusHead
// pre-skip. Measured on Chromium: bursts at 5s and 12s both peaked 22.4 ms late.
// Folding that into the pre-skip makes audio.currentTime match the original PCM clock.
const EXTRA_DELAY_SAMPLES = 1078;

export function speechSeconds(wordCount, speed = 1) {
  const words = Math.max(0, Number(wordCount) || 0);
  const sp = Number(speed) > 0 ? Number(speed) : 1;
  return (words / (150 * sp)) * 60;
}

export function defaultSynthRate(quality) {
  return quality === "fast" ? 1.2 : 0.5;
}

// Wall-clock seconds still to go. After the first chunk, rate is measured (elapsed / audio done).
export function remainingSeconds(elapsedSec, audioDoneSec, audioTotalSec, priorRate) {
  const elapsed = Math.max(0, Number(elapsedSec) || 0);
  const done = Math.max(0, Number(audioDoneSec) || 0);
  const total = Math.max(done, Number(audioTotalSec) || 0);
  const measured = done >= 0.2;
  const rate = measured ? elapsed / done : (Number(priorRate) > 0 ? Number(priorRate) : 0.5);
  const left = (total - done) * rate;
  return Math.max(0, measured ? left : left - elapsed);
}

export function estimateHtmlBytes(durationSec, textChars = 0, imageBytes = 0) {
  const audio = Math.max(0, Number(durationSec) || 0) * (OPUS_BITRATE / 8) * 1.11;
  const images = Math.max(0, Number(imageBytes) || 0);
  return Math.round((audio * 4) / 3 + Math.max(0, Number(textChars) || 0) + images + 2500);
}

export function formatBytes(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1000) return `${Math.round(b)} B`;
  if (b < 1e6) return `${Math.round(b / 1000)} KB`;
  if (b < 10e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e6)} MB`;
}

export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function vint(value) {
  let length = 1;
  while (length < 8 && value >= 2 ** (7 * length) - 1) length += 1;
  const out = new Uint8Array(length);
  let x = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = x & 0xff;
    x = Math.floor(x / 256);
  }
  out[0] |= 1 << (8 - length);
  return out;
}

const ID = {
  EBML: Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3),
  EBMLVersion: Uint8Array.of(0x42, 0x86),
  EBMLReadVersion: Uint8Array.of(0x42, 0xf7),
  EBMLMaxIDLength: Uint8Array.of(0x42, 0xf2),
  EBMLMaxSizeLength: Uint8Array.of(0x42, 0xf3),
  DocType: Uint8Array.of(0x42, 0x82),
  DocTypeVersion: Uint8Array.of(0x42, 0x87),
  DocTypeReadVersion: Uint8Array.of(0x42, 0x85),
  Segment: Uint8Array.of(0x18, 0x53, 0x80, 0x67),
  Info: Uint8Array.of(0x15, 0x49, 0xa9, 0x66),
  TimestampScale: Uint8Array.of(0x2a, 0xd7, 0xb1),
  Duration: Uint8Array.of(0x44, 0x89),
  MuxingApp: Uint8Array.of(0x4d, 0x80),
  WritingApp: Uint8Array.of(0x57, 0x41),
  Tracks: Uint8Array.of(0x16, 0x54, 0xae, 0x6b),
  TrackEntry: Uint8Array.of(0xae),
  TrackNumber: Uint8Array.of(0xd7),
  TrackUID: Uint8Array.of(0x73, 0xc5),
  TrackType: Uint8Array.of(0x83),
  CodecID: Uint8Array.of(0x86),
  CodecPrivate: Uint8Array.of(0x63, 0xa2),
  CodecDelay: Uint8Array.of(0x56, 0xaa),
  SeekPreRoll: Uint8Array.of(0x56, 0xbb),
  Audio: Uint8Array.of(0xe1),
  SamplingFrequency: Uint8Array.of(0xb5),
  Channels: Uint8Array.of(0x9f),
  Cluster: Uint8Array.of(0x1f, 0x43, 0xb6, 0x75),
  Timestamp: Uint8Array.of(0xe7),
  SimpleBlock: Uint8Array.of(0xa3),
};

function element(idBytes, data) {
  return concat([idBytes, vint(data.length), data]);
}

function uintEl(idBytes, value) {
  const v = Math.max(0, Math.floor(value));
  const bytes = [];
  let x = v;
  do { bytes.push(x & 0xff); x = Math.floor(x / 256); } while (x > 0);
  bytes.reverse();
  return element(idBytes, Uint8Array.from(bytes));
}

function floatEl(idBytes, value) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, false);
  return element(idBytes, new Uint8Array(buf));
}

function doubleEl(idBytes, value) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return element(idBytes, new Uint8Array(buf));
}

function strEl(idBytes, text) {
  return element(idBytes, new TextEncoder().encode(text));
}

function simpleBlock(relMs, packet) {
  const body = new Uint8Array(4 + packet.length);
  body[0] = 0x81;
  body[1] = (relMs >> 8) & 0xff;
  body[2] = relMs & 0xff;
  body[3] = 0x80;
  body.set(packet, 4);
  return element(ID.SimpleBlock, body);
}

function defaultOpusHead() {
  const b = new Uint8Array(19);
  b.set(new TextEncoder().encode("OpusHead"), 0);
  b[8] = 1;
  b[9] = 1;
  b[10] = 312 & 0xff;
  b[11] = (312 >> 8) & 0xff;
  new DataView(b.buffer).setUint32(12, 48000, true);
  return b;
}

function withExtraDelay(description) {
  const desc = new Uint8Array(description?.length ? description : defaultOpusHead());
  if (new TextDecoder().decode(desc.subarray(0, 8)) !== "OpusHead" || desc.length < 12) return desc;
  const next = (desc[10] | (desc[11] << 8)) + EXTRA_DELAY_SAMPLES;
  desc[10] = next & 0xff;
  desc[11] = (next >> 8) & 0xff;
  return desc;
}

function preskipOf(description) {
  if (!description || description.length < 12) return 312;
  const head = new TextDecoder().decode(description.subarray(0, 8));
  if (head !== "OpusHead") return 312;
  return description[10] | (description[11] << 8);
}

export function muxOpusWebm({ packets, description, durationSec }) {
  if (!packets?.length) throw new Error("no audio packets");
  const desc = description?.length ? description : defaultOpusHead();
  const preskip = preskipOf(desc);
  const header = element(ID.EBML, concat([
    uintEl(ID.EBMLVersion, 1),
    uintEl(ID.EBMLReadVersion, 1),
    uintEl(ID.EBMLMaxIDLength, 4),
    uintEl(ID.EBMLMaxSizeLength, 8),
    strEl(ID.DocType, "webm"),
    uintEl(ID.DocTypeVersion, 4),
    uintEl(ID.DocTypeReadVersion, 2),
  ]));
  const info = element(ID.Info, concat([
    uintEl(ID.TimestampScale, 1000000),
    doubleEl(ID.Duration, Math.max(0, durationSec) * 1000),
    strEl(ID.MuxingApp, "Listen Later"),
    strEl(ID.WritingApp, "Listen Later"),
  ]));
  const track = element(ID.Tracks, element(ID.TrackEntry, concat([
    uintEl(ID.TrackNumber, 1),
    uintEl(ID.TrackUID, 1),
    uintEl(ID.TrackType, 2),
    strEl(ID.CodecID, "A_OPUS"),
    uintEl(ID.CodecDelay, Math.round((preskip / 48000) * 1e9)),
    uintEl(ID.SeekPreRoll, 80000000),
    element(ID.Audio, concat([
      floatEl(ID.SamplingFrequency, 48000),
      uintEl(ID.Channels, 1),
    ])),
    element(ID.CodecPrivate, desc),
  ])));
  const clusters = [];
  let group = [];
  let clusterStart = 0;
  const flush = () => {
    if (!group.length) return;
    clusters.push(element(ID.Cluster, concat([
      uintEl(ID.Timestamp, clusterStart),
      ...group.map((p) => simpleBlock(Math.round(p.timestampUs / 1000) - clusterStart, p.data)),
    ])));
    group = [];
  };
  for (const p of packets) {
    const ms = Math.max(0, Math.round(p.timestampUs / 1000));
    if (!group.length) clusterStart = ms;
    else if (ms - clusterStart > 30000) { flush(); clusterStart = ms; }
    group.push(p);
  }
  flush();
  const segment = element(ID.Segment, concat([info, track, ...clusters]));
  return concat([header, segment]);
}

function resampleTo48k(input, fromRate) {
  if (fromRate === 48000) return input;
  const outLen = Math.max(1, Math.round(input.length * 48000 / fromRate));
  const out = new Float32Array(outLen);
  const scale = fromRate / 48000;
  const last = input.length - 1;
  for (let i = 0; i < outLen; i += 1) {
    const x = i * scale;
    const i0 = Math.min(last, Math.floor(x));
    const i1 = Math.min(last, i0 + 1);
    const f = x - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

async function opusConfigSupported() {
  if (typeof AudioEncoder === "undefined" || !AudioEncoder.isConfigSupported) return false;
  const base = { codec: "opus", sampleRate: 48000, numberOfChannels: 1, bitrate: OPUS_BITRATE };
  try {
    const withMode = await AudioEncoder.isConfigSupported({ ...base, bitrateMode: "constant" });
    if (withMode?.supported) return { ...base, bitrateMode: "constant" };
  } catch (e) { /* bitrateMode is optional */ }
  try {
    const plain = await AudioEncoder.isConfigSupported(base);
    return plain?.supported ? base : null;
  } catch (e) {
    return null;
  }
}

function mediaRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}

function cancelled(shouldCancel) {
  if (shouldCancel?.()) {
    const err = new Error("cancelled");
    err.name = "AbortError";
    throw err;
  }
}

async function encodeOpus(samples, sampleRate, { shouldCancel, onProgress } = {}) {
  const config = await opusConfigSupported();
  if (!config) return null;
  const packets = [];
  let description = null;
  let encoderError = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description);
      packets.push({ timestampUs: Math.max(0, chunk.timestamp || 0), data });
    },
    error: (e) => { encoderError = e; },
  });
  encoder.configure(config);
  const pcm = resampleTo48k(samples, sampleRate);
  let timestamp = 0;
  for (let i = 0; i < pcm.length; i += FRAME) {
    cancelled(shouldCancel);
    if (encoderError) throw encoderError;
    const frames = Math.min(FRAME, pcm.length - i);
    const data = new Float32Array(frames);
    data.set(pcm.subarray(i, i + frames));
    const audio = new AudioData({
      format: "f32-planar",
      sampleRate: 48000,
      numberOfFrames: frames,
      numberOfChannels: 1,
      timestamp,
      data,
    });
    encoder.encode(audio);
    audio.close();
    timestamp += Math.round((frames / 48000) * 1e6);
    if (encoder.encodeQueueSize > 8) {
      await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
    }
    if (onProgress) onProgress(Math.min(1, (i + frames) / pcm.length));
  }
  cancelled(shouldCancel);
  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  if (!packets.length) throw new Error("encoder produced no audio");
  const durationSec = samples.length / sampleRate;
  return {
    bytes: muxOpusWebm({ packets, description: withExtraDelay(description), durationSec }),
    mime: "audio/webm",
    label: "Opus audio, 24 kbps mono, stored in this file",
  };
}

async function encodeWithRecorder(samples, sampleRate, { shouldCancel, onProgress } = {}) {
  const mime = mediaRecorderMime();
  if (!mime) return null;
  const ctx = new AudioContext({ sampleRate });
  const dest = ctx.createMediaStreamDestination();
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: OPUS_BITRATE });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });
  const duration = samples.length / sampleRate;
  rec.start(200);
  src.start();
  const tick = setInterval(() => {
    if (shouldCancel?.()) { try { src.stop(); } catch (e) {} try { rec.stop(); } catch (e) {} }
    else if (onProgress) onProgress(Math.min(1, ctx.currentTime / duration));
  }, 200);
  try {
    await new Promise((resolve) => { src.onended = resolve; });
    if (rec.state !== "inactive") rec.stop();
    await stopped;
  } finally {
    clearInterval(tick);
    await ctx.close().catch(() => {});
  }
  cancelled(shouldCancel);
  const blob = new Blob(chunks, { type: "audio/webm" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.length) throw new Error("recorder produced no audio");
  return { bytes, mime: "audio/webm", label: "Opus audio, stored in this file" };
}

// One-shot encode used by tests and by Save episode after the sentences are joined.
export async function encodePcm(samples, sampleRate, opts = {}) {
  cancelled(opts.shouldCancel);
  try {
    const opus = await encodeOpus(samples, sampleRate, opts);
    if (opus) return { ...opus, codec: "opus" };
  } catch (e) {
    if (e?.name === "AbortError") throw e;
  }
  const recorded = await encodeWithRecorder(samples, sampleRate, opts);
  if (recorded) return { ...recorded, codec: "opus-recorder" };
  return {
    bytes: encodeWav(samples, sampleRate),
    mime: "audio/wav",
    codec: "wav",
    label: `16-bit WAV at ${sampleRate} Hz, stored in this file`,
  };
}
