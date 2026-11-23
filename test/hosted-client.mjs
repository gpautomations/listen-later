// Hosted-link helpers that do not need Chrome: URL rules, QR, WAV fallback, no em dashes in copy.
import fs from "node:fs";
import { encodeEpisodeAudio, resampleLinear } from "../src/lib/hosted/audio.mjs";
import { buildManifest, hostPermissionPattern, normalizeBaseUrl } from "../src/lib/hosted/manifest.mjs";
import { qrMatrix } from "../src/lib/hosted/qr.mjs";

const fail = (s) => { console.error(s); process.exit(1); };

const base = normalizeBaseUrl("https://listen-later-hosted-staging.scott-408.workers.dev/e/ignored");
if (base !== "https://listen-later-hosted-staging.scott-408.workers.dev") fail("origin " + base);
if (hostPermissionPattern(base) !== "https://listen-later-hosted-staging.scott-408.workers.dev/*") fail("pattern");
if (normalizeBaseUrl("http://127.0.0.1:8787") !== "http://127.0.0.1:8787") fail("localhost");
let threw = false;
try { normalizeBaseUrl("http://example.com"); } catch (e) { threw = true; }
if (!threw) fail("http origin should be rejected");

const manifest = buildManifest({
  title: "Passage",
  sourceUrl: "https://www.gutenberg.org/ebooks/1342",
  voiceLabel: "Heart",
  durationSec: 1,
  blocks: [{ type: "p", words: [{ text: "It", start: 0, end: 0.4 }] }],
});
if (manifest.v !== 1 || manifest.blocks[0].words[0].text !== "It") fail("manifest");

const up = resampleLinear(new Float32Array([0, 1]), 24000, 48000);
if (up.length !== 4) fail("resample length " + up.length);

const audio = await encodeEpisodeAudio(new Float32Array(2400), 24000);
if (audio.mime !== "audio/wav") fail("node should fall back to wav, got " + audio.mime);
if (Buffer.from(audio.bytes.slice(0, 4)).toString("ascii") !== "RIFF") fail("wav magic");

const matrix = qrMatrix("https://listen-later-hosted-staging.scott-408.workers.dev/e/abcdefghijABCDEFGHIJ12");
if (matrix.length < 21 || matrix.some((row) => row.length !== matrix.length)) fail("qr shape");
if (!matrix.some((row) => row.some(Boolean)) || !matrix.some((row) => row.some((cell) => !cell))) fail("qr blank");

const copyFiles = [
  "src/lib/hosted/player.mjs",
  "src/hosted-options.js",
  "hosted/src/page.js",
  "hosted/src/assets.js",
  "hosted/legal/terms-of-use.md",
  "hosted/legal/privacy-policy-additions.md",
  "hosted/README.md",
];
for (const file of copyFiles) {
  const text = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  if (text.includes("\u2014")) fail("em dash in " + file);
}
const content = fs.readFileSync(new URL("../src/content.src.js", import.meta.url), "utf8");
if (!content.includes('aria-label="Save episode"')) fail("save button missing");
if (!content.includes("attachHostedSave")) fail("hosted hook missing");
console.log("hosted client ok", matrix.length);
