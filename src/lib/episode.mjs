// SPDX-License-Identifier: GPL-3.0-or-later
// Save episode: one self-contained HTML file with article text, word timings and 16-bit WAV audio.
// Kokoro already returns Float32 PCM in the browser. WAV needs no encoder and plays offline.
// 16-bit mono at 24 kHz is about 2.9 MB per minute, plus a little for the page text.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function concatFloat32(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function float32FromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.byteLength % 4 !== 0) throw new Error("audio buffer is not a whole number of samples");
  return new Float32Array(bytes.buffer);
}

// Each chunk is a multiple of 3 bytes except the last, so the base64 pieces concatenate.
export function bytesToBase64(bytes) {
  const parts = [];
  const stride = 32766;
  for (let i = 0; i < bytes.length; i += stride) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + stride));
    let bin = "";
    for (let j = 0; j < slice.length; j += 0x8000) bin += String.fromCharCode.apply(null, slice.subarray(j, j + 0x8000));
    parts.push(btoa(bin));
  }
  return parts.join("");
}

export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const write = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  write(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  write(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    let q = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    if (q < -32768) q = -32768;
    if (q > 32767) q = 32767;
    v.setInt16(o, q, true);
    o += 2;
  }
  return bytes;
}

export function episodeFilename(title) {
  const base = (title || "article").normalize("NFKD").replace(/[^\w\s.-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
  return `listen-later-${base || "article"}.html`;
}

function clock(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function sourceHtml(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return esc(url || "");
    const href = esc(u.href);
    return `<a href="${href}" rel="noreferrer noopener">${href}</a>`;
  } catch (e) {
    return esc(url || "");
  }
}

const PLAYER_SCRIPT = `
(function () {
  var audio = document.getElementById("audio");
  var words = [].slice.call(document.querySelectorAll("[data-s]"));
  var held = document.getElementById("wav");
  var b64 = held ? held.textContent.replace(/\\s+/g, "") : "";
  held.textContent = "";
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  audio.src = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  var current = -1;
  function tick() {
    var t = audio.currentTime;
    var i = current;
    if (!(i >= 0 && t >= +words[i].getAttribute("data-s") && t < +words[i].getAttribute("data-e"))) {
      i = -1;
      for (var k = 0; k < words.length; k++) {
        if (+words[k].getAttribute("data-s") <= t && t < +words[k].getAttribute("data-e")) { i = k; break; }
      }
    }
    if (i === current) return;
    if (current >= 0) words[current].classList.remove("on");
    current = i;
    if (i < 0) return;
    words[i].classList.add("on");
    var r = words[i].getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 40) words[i].scrollIntoView({ block: "center", behavior: "smooth" });
  }
  audio.addEventListener("timeupdate", tick);
  audio.addEventListener("seeked", tick);
  audio.addEventListener("play", tick);
  words.forEach(function (w) {
    w.addEventListener("click", function () {
      audio.currentTime = +w.getAttribute("data-s");
      audio.play();
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    if (e.target && e.target.closest && e.target.closest("a,button,input,textarea")) return;
    e.preventDefault();
    if (audio.paused) audio.play(); else audio.pause();
  });
})();
`;

export function buildEpisodeHtml({ title, sourceUrl, blocks, wavBase64, voiceLabel, durationSec }) {
  const safeTitle = esc(title || "Article");
  const paras = (blocks || []).map((words) => {
    const spans = words.map((w) => {
      const start = Number(w.start);
      const end = Number(w.end);
      return `<span data-s="${start.toFixed(3)}" data-e="${end.toFixed(3)}">${esc(w.text)}</span>`;
    }).join(" ");
    return `<p>${spans}</p>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #fafaf9; color: #1c1c1e; font: 18px/1.6 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }
  header, article, footer { max-width: 40rem; margin: 0 auto; padding: 0 1.25rem; }
  header { padding-top: 1.5rem; }
  h1 { font: 600 1.6rem/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0 0 .4rem; }
  .meta, footer, .src { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #555; }
  .src a { color: #0b57d0; }
  .bar { position: sticky; top: 0; z-index: 2; background: #121214; padding: .6rem 0; }
  .bar audio { display: block; width: min(40rem, calc(100% - 2.5rem)); margin: 0 auto; }
  article { padding-bottom: 2rem; }
  article p { margin: 0 0 1rem; }
  span[data-s] { border-radius: 3px; cursor: pointer; }
  span[data-s]:hover { background: rgba(255, 190, 0, .25); }
  span.on { background: #ffbe00; }
  footer { padding-bottom: 3rem; }
</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <p class="meta">Saved with Listen Later. Length ${clock(durationSec)}. The audio is inside this file. Nothing is loaded from the internet.</p>
  <p class="src">Source: ${sourceHtml(sourceUrl)}</p>
</header>
<div class="bar"><audio id="audio" controls preload="none"></audio></div>
<article>
${paras || "<p>No article text.</p>"}
</article>
<footer>Voice: ${esc(voiceLabel || "Kokoro")}, generated on your computer. 16-bit WAV at 24 kHz, stored in this file. This file is yours. Press space to play or pause. Click a word to jump there.</footer>
<script type="text/plain" id="wav">${wavBase64 || ""}</script>
<script>${PLAYER_SCRIPT}</script>
<noscript>JavaScript is off, so word highlighting will not run. The audio is still in this file.</noscript>
</body>
</html>
`;
}
