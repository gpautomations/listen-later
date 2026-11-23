// Browser entry for the mobile playback check. No Kokoro model.
import { buildEpisodeHtml, bytesToBase64 } from "../src/lib/episode.mjs";
import { encodeImageSource } from "../src/lib/images.mjs";
import { encodePcm } from "../src/lib/speech-audio.mjs";

export async function makeEpisode() {
  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = 60;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c04020";
  ctx.fillRect(0, 0, 80, 60);
  const image = await encodeImageSource(canvas);
  const sr = 24000;
  const pcm = new Float32Array(sr);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    if (t >= 0.2 && t < 0.55) pcm[i] = Math.sin((2 * Math.PI * 440 * t)) * 0.4;
  }
  const encoded = await encodePcm(pcm, sr);
  const html = buildEpisodeHtml({
    title: "Mobile check",
    sourceUrl: "https://example.com/article",
    parts: [
      { type: "words", words: [{ text: "Hello", start: 0.2, end: 0.55 }] },
      { type: "image", src: image.dataUrl, alt: "A red block" },
    ],
    audioBase64: bytesToBase64(encoded.bytes),
    audioMime: encoded.mime,
    codecLabel: encoded.label,
    voiceLabel: "test",
    durationSec: 1,
  });
  return {
    html,
    codec: encoded.codec,
    mime: encoded.mime,
    imageType: image.type,
    imageBytes: image.bytes,
    audioBytes: encoded.bytes.length,
  };
}
