// Save-episode file format: WAV header, escaped HTML, no remote audio, no share blurb.
import fs from "node:fs";
import { buildEpisodeHtml, bytesToBase64, encodeWav, episodeFilename } from "../src/lib/episode.mjs";

const fail = (s) => { console.error(s); process.exit(1); };
const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
const wav = encodeWav(samples, 24000);
if (wav.length !== 44 + samples.length * 2) fail("wav length");
const text = Buffer.from(wav.slice(0, 4)).toString("ascii");
if (text !== "RIFF" || Buffer.from(wav.slice(8, 12)).toString("ascii") !== "WAVE") fail("not a wav");
const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1) fail("not pcm mono");
if (view.getUint32(24, true) !== 24000) fail("sample rate");
if (view.getUint16(34, true) !== 16) fail("bit depth");
if (view.getInt16(44, true) !== 0) fail("silence sample");
if (view.getInt16(46, true) !== 16384) fail("half sample " + view.getInt16(46, true));
if (view.getInt16(48, true) !== -16384) fail("negative sample");
if (view.getInt16(50, true) !== 32767) fail("full scale");
if (view.getInt16(52, true) !== -32768) fail("negative full scale");

const b64 = bytesToBase64(wav);
if (Buffer.from(b64, "base64").length !== wav.length) fail("base64 roundtrip");
const nasty = "</title><script>alert(1)</script>";
const html = buildEpisodeHtml({
  title: nasty,
  sourceUrl: "https://example.com/a?b=1&c=2",
  blocks: [[{ text: 'a<b> & "c"', start: 0, end: 0.42 }, { text: "world", start: 0.42, end: 0.9 }]],
  wavBase64: b64,
  voiceLabel: "Heart (US F)",
  durationSec: 0.9,
});
if (html.includes("<script>alert")) fail("script leaked");
if (!html.includes("&lt;/title&gt;&lt;script&gt;")) fail("title not escaped");
if (!html.includes("a&lt;b&gt; &amp; &quot;c&quot;")) fail("word not escaped");
if (!html.includes("https://example.com/a?b=1&amp;c=2")) fail("url not escaped");
if (!html.includes('data-s="0.000"') || !html.includes('data-e="0.420"')) fail("timings");
if (!html.includes(b64)) fail("audio missing");
if (!html.includes("audio/wav")) fail("wav mime");
if (html.includes("—")) fail("em dash in episode html");
if (/src\s*=\s*["']https?:/i.test(html)) fail("remote resource");
const jsUrl = buildEpisodeHtml({ title: "x", sourceUrl: "javascript:alert(1)", blocks: [], wavBase64: "", voiceLabel: "v", durationSec: 0 });
if (jsUrl.includes('href="javascript:')) fail("javascript url linked");
if (episodeFilename("Hello, World!") !== "listen-later-Hello-World.html") fail("filename " + episodeFilename("Hello, World!"));
if (episodeFilename("") !== "listen-later-article.html") fail("empty filename");

const content = fs.readFileSync(new URL("../src/content.src.js", import.meta.url), "utf8");
if (content.includes("listen along, word by word")) fail("share blurb still in the content script");
if (content.includes('class="share"')) fail("share button still in the content script");
if (!content.includes('aria-label="Save episode"')) fail("save button missing");
console.log("episode html ok", html.length, "bytes");
