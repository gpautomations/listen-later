// Listen Later TTS engine (v2). Runs in an MV3 offscreen document (has WebGPU + WASM; the service worker does not).
// Loads Kokoro-82M (ONNX, timestamped export) via transformers.js, caches it in the browser Cache Storage,
// and returns lossless Float32 audio + per-word timings for each sentence. Nothing leaves the machine except the
// one-time model/voice download from huggingface.co.
import { env, StyleTextToSpeech2Model, AutoTokenizer, Tensor } from "@huggingface/transformers";
import { phonemize } from "./lib/phonemize.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
const VOICE_URL = (v) => `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${v}.bin`;
const SAMPLE_RATE = 24000;
// Quality -> model precision.
// High = full fp32 Kokoro (same weights as the reference Python server). Default on WebGPU *and* WASM: on WASM it measured
//        as fast as anything else (RTF ~0.4 on 7 threads) and is the only variant with zero artifacts.
// Fast = q8 (92 MB instead of 326 MB download, less memory), slightly less clear and ~2.5x slower on WASM.
// fp16 is deliberately NOT used: on WASM it produced all-NaN (silent) audio for ~1 in 6 sentences (v1 bug).
const DTYPE = { high: "fp32", fast: "q8" };

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/");
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1)) : 1;

// Count engine-side errors so tests (and the status message) can surface them.
const engineErrors = [];
const _err = console.error.bind(console);
console.error = (...a) => { engineErrors.push(a.map(String).join(" ").slice(0, 300)); _err(...a); };
self.addEventListener("error", (e) => engineErrors.push("error: " + e.message));
self.addEventListener("unhandledrejection", (e) => engineErrors.push("rejection: " + (e.reason?.message || e.reason)));

let engine = null; // { model, vocab, device, dtype, quality }
let loading = null; // { key, promise }
let tokenizerP = null;
let gpuState = null; // "webgpu" | "none"
const voiceCache = new Map();

async function detectGpu() {
  if (gpuState) return gpuState;
  try {
    const adapter = navigator.gpu && (await navigator.gpu.requestAdapter());
    // Software (fallback) adapters such as SwiftShader are far slower than WASM; skip them.
    gpuState = adapter && !(adapter.info?.isFallbackAdapter || adapter.isFallbackAdapter) ? "webgpu" : "none";
  } catch (e) { gpuState = "none"; }
  return gpuState;
}

async function resolveConfig(opts = {}) {
  const gpu = await detectGpu();
  let device = opts.device === "wasm" ? "wasm" : opts.device === "webgpu" ? "webgpu" : gpu === "webgpu" ? "webgpu" : "wasm";
  // Auto quality = High everywhere (see DTYPE note above).
  let quality = opts.quality === "high" || opts.quality === "fast" ? opts.quality : "high";
  const dtype = opts.dtype || DTYPE[quality];
  return { device, quality, dtype };
}

function broadcast(tabId, payload) {
  if (tabId == null || tabId < 0) return;
  chrome.runtime.sendMessage({ type: "relay", tabId, payload }).catch(() => {});
}

async function load(tabId, opts = {}) {
  if (opts.threads) env.backends.onnx.wasm.numThreads = opts.threads;
  const cfg = await resolveConfig(opts);
  const key = `${cfg.device}/${cfg.dtype}`;
  if (engine && engine.key === key) return engine;
  if (loading && loading.key === key) return loading.promise;
  const promise = (async () => {
    const t0 = performance.now();
    if (engine) { try { await engine.model.dispose?.(); } catch (e) {} engine = null; }
    const files = {};
    const progress_callback = (p) => {
      if (p.status === "progress" && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        let l = 0, t = 0;
        for (const f of Object.values(files)) { l += f.loaded; t += f.total; }
        broadcast(tabId, { type: "progress", stage: "download", pct: t ? Math.round((100 * l) / t) : 0, loadedMB: +(l / 1e6).toFixed(1), totalMB: +(t / 1e6).toFixed(1) });
      }
    };
    tokenizerP ||= AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
    let { device, dtype, quality } = cfg, model;
    try {
      model = await StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { dtype, device, progress_callback });
    } catch (e) {
      if (device !== "webgpu") throw e;
      console.warn("[ListenLater] WebGPU load failed, falling back to WASM", e);
      device = "wasm";
      model = await StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { dtype, device, progress_callback });
    }
    const tokenizer = await tokenizerP;
    engine = { key: `${device}/${dtype}`, model, vocab: tokenizer.model.tokens_to_ids, device, dtype, quality, threads: env.backends.onnx.wasm.numThreads, loadMs: Math.round(performance.now() - t0) };
    broadcast(tabId, { type: "progress", stage: "ready", device, dtype, quality });
    return engine;
  })();
  loading = { key, promise };
  try { return await promise; } finally { if (loading?.promise === promise) loading = null; }
}

async function getVoice(voice) {
  if (voiceCache.has(voice)) return voiceCache.get(voice);
  const url = VOICE_URL(voice);
  let buf;
  try {
    const cache = await caches.open("listen-later-voices");
    let res = await cache.match(url);
    if (!res) { res = await fetch(url); if (!res.ok) throw new Error("voice fetch " + res.status); await cache.put(url, res.clone()); }
    buf = await res.arrayBuffer();
  } catch (e) {
    const res = await fetch(url); buf = await res.arrayBuffer();
  }
  const arr = new Float32Array(buf);
  voiceCache.set(voice, arr);
  return arr;
}

// Lossless transfer: raw Float32 samples, base64 (runtime messaging is JSON-only).
function f32ToB64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const splitWords = (ph) => ph.split(/ +/).filter(Boolean);

// Map each text word to a run of phoneme-words from the *whole-sentence* phonemization.
// Phonemizing the full sentence (like kokoro-js and the Python kokoro package) keeps natural stress and weak forms
// ("the" -> ðə, "a" -> ɐ); v1 phonemized word-by-word, which made speech sound choppier.
async function alignWords(words, lang) {
  const sentPh = await phonemize(words.join(" "), lang);
  const P = splitWords(sentPh);
  const iso = await Promise.all(words.map((w) => phonemize(w, lang)));
  const counts = iso.map((p) => splitWords(p).length);
  const owner = new Array(P.length);
  if (counts.reduce((a, b) => a + b, 0) === P.length) {
    let j = 0;
    counts.forEach((c, i) => { for (let k = 0; k < c; k++) owner[j++] = i; });
    return { P, owner, exact: true };
  }
  // Fallback: proportional alignment by isolated phoneme length.
  const lens = iso.map((p) => Math.max(p.length, 0.5));
  const total = lens.reduce((a, b) => a + b, 0);
  const bounds = []; let acc = 0;
  for (const l of lens) { acc += l; bounds.push(acc / total); }
  const pl = P.map((p) => p.length + 1), ptotal = pl.reduce((a, b) => a + b, 0);
  let cum = 0, wi = 0;
  for (let j = 0; j < P.length; j++) {
    const mid = (cum + pl[j] / 2) / ptotal; cum += pl[j];
    while (wi < words.length - 1 && mid > bounds[wi]) wi++;
    owner[j] = wi;
  }
  return { P, owner, exact: false };
}

let alignStats = { exact: 0, approx: 0 };

// Synthesize one chunk of words. Returns Float32 audio + per-word [start,end] in seconds.
async function synthChunk(words, voice, speed) {
  const { model, vocab } = engine;
  const lang = voice[0] === "b" ? "b" : "a";
  const space = vocab.get(" ");
  const { P, owner, exact } = await alignWords(words, lang);
  alignStats[exact ? "exact" : "approx"]++;
  const ids = [0];
  const spans = words.map(() => null);
  for (let j = 0; j < P.length; j++) {
    const start = ids.length;
    for (const ch of P[j]) { const id = vocab.get(ch); if (id !== undefined) ids.push(id); }
    const w = owner[j];
    if (ids.length > start) spans[w] = spans[w] ? [spans[w][0], ids.length] : [start, ids.length];
    if (j < P.length - 1) ids.push(space);
  }
  ids.push(0);
  const voiceData = await getVoice(voice);
  const n = ids.length;
  const off = 256 * Math.min(Math.max(n - 2, 0), 509);
  const style = voiceData.slice(off, off + 256);
  const out = await model({
    input_ids: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, n]),
    style: new Tensor("float32", style, [1, 256]),
    speed: new Tensor("float32", [speed], [1]),
  });
  const audio = out.waveform.data;
  const dur = Array.from(out.durations.data, Number);
  const total = dur.reduce((a, b) => a + b, 0) || 1;
  const secs = audio.length / SAMPLE_RATE;
  const unit = secs / total;
  const cum = [0];
  for (const d of dur) cum.push(cum[cum.length - 1] + d);
  const times = spans.map((s) => (s ? [cum[s[0]] * unit, cum[s[1]] * unit] : null));
  // words with no phonemes (e.g. "—") get a zero-length slot at the previous word's end
  let last = cum[1] * unit;
  for (let i = 0; i < times.length; i++) { if (!times[i]) times[i] = [last, last]; last = times[i][1]; }
  return { audio, times, secs };
}

const MAX_TOKENS = 380;
async function synth(words, voice, speed) {
  // Split very long sentences into chunks that fit Kokoro's 510-token context (prefer clause boundaries).
  const lang = voice[0] === "b" ? "b" : "a";
  const chunks = []; let cur = []; let est = 0;
  for (const w of words) {
    const len = (await phonemize(w, lang)).length + 1;
    if (cur.length && est + len > MAX_TOKENS) {
      let k = cur.length - 1; while (k > cur.length / 2 && !/[,;:—–]$/.test(cur[k])) k--;
      if (k > cur.length / 2) { chunks.push(cur.slice(0, k + 1)); cur = cur.slice(k + 1); } else { chunks.push(cur); cur = []; }
      est = 0; for (const c of cur) est += (await phonemize(c, lang)).length + 1;
    }
    cur.push(w); est += len;
  }
  if (cur.length) chunks.push(cur);
  const parts = []; const times = []; let offset = 0;
  for (const c of chunks) {
    const r = await synthChunk(c, voice, speed);
    parts.push(r.audio);
    for (const t of r.times) times.push([t[0] + offset, t[1] + offset]);
    offset += r.secs;
  }
  let audio = parts[0];
  if (parts.length > 1) { audio = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { audio.set(p, o); o += p.length; } }
  // NaN guard: never hand silent/garbage audio to the player.
  for (let i = 0; i < audio.length; i += 97) if (Number.isNaN(audio[i])) throw new Error("NaN audio from model (" + engine.dtype + ")");
  // Clipping guard: Kokoro output is normally within ±1; if a sentence ever peaks over, scale it down (no hard clipping).
  let peak = 0; for (let i = 0; i < audio.length; i++) { const a = Math.abs(audio[i]); if (a > peak) peak = a; }
  let scaled = false;
  if (peak > 0.99) { const g = 0.98 / peak; audio = Float32Array.from(audio, (x) => x * g); scaled = true; }
  return { audio, times, secs: offset, peak, scaled };
}

// Serial job queue; jobs from an older "epoch" for the same tab are dropped (user jumped/changed voice).
const latestEpoch = new Map();
let chain = Promise.resolve();

function respondAudio(r, genMs) {
  return { ok: true, f32: f32ToB64(r.audio), sampleRate: SAMPLE_RATE, times: r.times, secs: r.secs, genMs: Math.round(genMs), rtf: genMs ? +(genMs / 1000 / r.secs).toFixed(3) : 0,
    device: engine.device, dtype: engine.dtype, quality: engine.quality, peak: +r.peak.toFixed(4), scaled: r.scaled };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen") return false;
  const tabId = msg.tabId ?? sender.tab?.id;
  if (msg.type === "epoch") { latestEpoch.set(tabId, msg.epoch); sendResponse({ ok: true }); return false; }
  if (msg.type === "status") {
    detectGpu().then((gpu) => sendResponse({ ok: true, gpu, engine: engine && { device: engine.device, dtype: engine.dtype, quality: engine.quality, threads: engine.threads, loadMs: engine.loadMs }, crossOriginIsolated: self.crossOriginIsolated, align: alignStats, errors: engineErrors.slice(-20) }));
    return true;
  }
  if (msg.type === "load") {
    chain = chain.then(() => load(tabId, msg).then((e) => sendResponse({ ok: true, device: e.device, dtype: e.dtype, quality: e.quality, threads: e.threads, loadMs: e.loadMs })).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) })));
    return true;
  }
  if (msg.type === "synth") {
    if (msg.epoch !== undefined) latestEpoch.set(tabId, Math.max(latestEpoch.get(tabId) ?? 0, msg.epoch));
    chain = chain.then(async () => {
      if (msg.epoch !== undefined && msg.epoch < (latestEpoch.get(tabId) ?? 0)) return sendResponse({ ok: false, stale: true });
      const opts = { device: msg.device, quality: msg.quality, dtype: msg.dtype };
      try {
        await load(tabId, opts);
        const t0 = performance.now();
        const r = await synth(msg.words, msg.voice || "af_heart", msg.speed || 1);
        sendResponse(respondAudio(r, performance.now() - t0));
      } catch (e) {
        if (engine?.device === "webgpu") {
          // WebGPU can fail at run time on some drivers; drop to WASM once and retry.
          console.warn("[ListenLater] WebGPU synth failed, switching to WASM", e);
          gpuState = "none"; engine = null;
          try {
            await load(tabId, { ...opts, device: "wasm" });
            const r = await synth(msg.words, msg.voice || "af_heart", msg.speed || 1);
            return sendResponse(respondAudio(r, 0));
          } catch (e2) { e = e2; }
        }
        console.error("[ListenLater] synth failed", e);
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    });
    return true;
  }
  return false;
});
