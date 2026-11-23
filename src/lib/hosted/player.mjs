// SPDX-License-Identifier: GPL-3.0-or-later
// "Save and get link" lives in its own module so the on-device Save episode button can keep changing
// without this upload path. The button stays hidden until a hosted address is configured.
import { concatFloat32, float32FromBase64 } from "../episode.mjs";
import { configuredBase, ensureHostedPermission, uploadEpisode } from "./api.mjs";
import { encodeEpisodeAudio } from "./audio.mjs";
import { imagesBeforeBlocks } from "./images.mjs";
import { buildManifest } from "./manifest.mjs";
import { drawQr } from "./qr.mjs";

const LINK_ICON = '<svg viewBox="0 0 24 24"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l2.8-2.8a3 3 0 0 1 4.2 4.2l-1.4 1.4a1 1 0 1 1-1.4-1.4l1.4-1.4a1 1 0 0 0-1.4-1.4l-2.8 2.8a1 1 0 0 1-1.4 0zm2.8-2.8a1 1 0 0 1 0 1.4l-2.8 2.8a3 3 0 0 1-4.2-4.2l1.4-1.4a1 1 0 0 1 1.4 1.4L7.8 11.8a1 1 0 0 0 1.4 1.4l2.8-2.8a1 1 0 0 1 1.4 0z"/></svg>';

function showLink(panel, url) {
  panel.replaceChildren();
  panel.hidden = false;
  const label = document.createElement("p");
  label.className = "hosted-label";
  label.textContent = "Private link";
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.textContent = url;
  const row = document.createElement("div");
  row.className = "hosted-row";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "hosted-copy";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = "Copied";
    } catch (e) {
      copy.textContent = "Select the link";
    }
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "hosted-copy hosted-close";
  close.textContent = "Close";
  close.addEventListener("click", () => { panel.hidden = true; });
  row.append(copy, close);
  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = 180;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "QR code for the private link");
  try { drawQr(canvas, url); } catch (e) { canvas.remove(); }
  const note = document.createElement("p");
  note.className = "hosted-note";
  note.textContent = "Open this on your phone. Anyone with the link can listen. It is not listed anywhere.";
  panel.append(label, anchor, row, canvas, note);
}

async function saveAndLink(ctx, panel) {
  const S = ctx.getState();
  if (S.saving) return;
  let base = "";
  try { base = await configuredBase(); } catch (e) { base = ""; }
  if (!base) return;
  const allowed = await ensureHostedPermission(base).catch(() => false);
  if (!allowed) {
    ctx.toast("<b>Allow the hosted address</b><br><span style=\"color:#aaa\">Open options and press Save so Chrome can reach it.</span>", "err", 12000);
    return;
  }
  if (S.playing) await ctx.pause();
  if (!ctx.prepare() || !S.sentences?.length) {
    ctx.toast("No article found on this page.", "err");
    return;
  }
  ctx.setSaveLocked(true);
  S.epoch += 1;
  const epoch = S.epoch;
  ctx.send({ type: "epoch", epoch }).catch(() => {});
  ctx.toast("Creating the audio on this computer, then uploading the private link.", "ok", 20000);
  try {
    const chunks = [];
    const paragraphs = [];
    let cur = [];
    const starts = new Set(S.blockStarts || [0]);
    let samples = 0;
    let sampleRate = 24000;
    for (let s = 0; s < S.sentences.length; s++) {
      if (epoch !== S.epoch) {
        ctx.toast("Save cancelled.", "err");
        return;
      }
      ctx.setStatus(`Link ${s + 1}/${S.sentences.length}`);
      ctx.setAttr("hosted", `${s + 1}/${S.sentences.length}`);
      const words = S.sentences[s].map((u) => S.units[u].text);
      const r = await ctx.send({ type: "synth", words, voice: S.voice, speed: S.speed, quality: S.quality, epoch });
      if (epoch !== S.epoch) {
        ctx.toast("Save cancelled.", "err");
        return;
      }
      if (!r?.ok) throw new Error(r?.error || "voice failed");
      const audio = float32FromBase64(r.f32);
      if (chunks.length && r.sampleRate !== sampleRate) throw new Error("sample rate changed");
      sampleRate = r.sampleRate;
      const t0 = samples / sampleRate;
      S.sentences[s].forEach((ui, i) => {
        if (starts.has(ui) && cur.length) {
          paragraphs.push(cur);
          cur = [];
        }
        const span = r.times[i] || [0, 0];
        cur.push({ text: S.units[ui].text, start: span[0] + t0, end: span[1] + t0 });
      });
      chunks.push(audio);
      samples += audio.length;
      S.modelReady = true;
    }
    if (cur.length) paragraphs.push(cur);
    ctx.setStatus("Encoding");
    const encoded = await encodeEpisodeAudio(concatFloat32(chunks), sampleRate);
    const { images, before } = await imagesBeforeBlocks(ctx.blockElements());
    const blocks = [];
    paragraphs.forEach((words, i) => {
      if (before[i]) blocks.push({ type: "img", name: before[i].name, alt: before[i].alt });
      blocks.push({ type: "p", words });
    });
    const voice = ctx.voices.find(([id]) => id === S.voice);
    const manifest = buildManifest({
      title: ctx.title(),
      sourceUrl: ctx.sourceUrl(),
      voiceLabel: voice ? voice[1] : S.voice,
      durationSec: samples / sampleRate,
      blocks,
    });
    ctx.setStatus("Uploading");
    const result = await uploadEpisode(manifest, encoded, images);
    ctx.setAttr("hosted-url", result.url);
    ctx.setStatus("Link ready");
    showLink(panel, result.url);
    ctx.toast("Private link is ready. Copy it or scan the code.", "ok", 8000);
  } catch (e) {
    ctx.toast("Couldn't make the link: " + ctx.esc(e.message || e), "err", 12000);
    ctx.setStatus("Link failed");
  } finally {
    ctx.setSaveLocked(false);
  }
}

export function attachHostedSave(ctx) {
  const style = document.createElement("style");
  style.textContent = `
    button.hosted[hidden] { display: none; }
    .hosted-panel[hidden] { display: none; }
    .hosted-panel a { color: #9ec1ff; overflow-wrap: anywhere; font-size: 12px; }
    .hosted-label, .hosted-note { margin: 0 0 6px; font-size: 12px; color: #ddd; }
    .hosted-row { display: flex; gap: 8px; margin: 8px 0; }
    .hosted-panel button.hosted-copy { width: auto; height: 28px; padding: 0 12px; border-radius: 999px; background: #ffbe00; color: #111; font-size: 12px; font-weight: 650; }
    .hosted-panel button.hosted-close { background: rgba(255,255,255,.12); color: #fff; }
    .hosted-panel canvas { display: block; background: #fff; border-radius: 8px; }
  `;
  ctx.shadow.appendChild(style);
  const btn = document.createElement("button");
  btn.className = "hosted";
  btn.type = "button";
  btn.hidden = true;
  btn.title = "Save and get a private link that opens this read-along on your phone";
  btn.setAttribute("aria-label", "Save and get link");
  btn.innerHTML = LINK_ICON;
  ctx.ui.save.insertAdjacentElement("afterend", btn);
  ctx.ui.hosted = btn;
  const panel = document.createElement("div");
  panel.className = "card hosted-panel";
  panel.hidden = true;
  const wrap = ctx.shadow.querySelector(".wrap");
  wrap.insertBefore(panel, ctx.shadow.querySelector(".pill"));
  async function refresh() {
    let base = "";
    try { base = await configuredBase(); } catch (e) { base = ""; }
    btn.hidden = !base;
  }
  refresh();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.hostedBaseUrl || changes.hostedBaseCleared)) refresh();
    });
  } catch (e) { /* options page is the only writer */ }
  btn.addEventListener("click", () => { saveAndLink(ctx, panel); });
}
