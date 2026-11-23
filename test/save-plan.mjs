// Estimates, the hidden Drive client id, and the WebM header. Opus size is measured in test/opus-size.mjs.
import { driveClientConfigured } from "../src/lib/drive-config.mjs";
import { qrSvg } from "../src/lib/qr.mjs";
import { estimateHtmlBytes, formatBytes, muxOpusWebm, remainingSeconds, speechSeconds } from "../src/lib/speech-audio.mjs";

const fail = (s) => { console.error(s); process.exit(1); };

if (Math.abs(speechSeconds(150, 1) - 60) > 0.01) fail("speech seconds");
if (Math.abs(speechSeconds(150, 2) - 30) > 0.01) fail("speech seconds at 2x");
const early = remainingSeconds(1, 0, 60, 0.5);
if (Math.abs(early - 29) > 0.01) fail("prior remaining " + early);
const measured = remainingSeconds(2, 4, 10, 9);
if (Math.abs(measured - 3) > 0.01) fail("measured remaining " + measured);
const htmlBytes = estimateHtmlBytes(60, 0);
if (htmlBytes < 200000 || htmlBytes > 400000) fail("html estimate " + htmlBytes);
if (estimateHtmlBytes(60, 0, 50000) - htmlBytes !== 50000) fail("image bytes not added");
const svg = qrSvg("https://drive.google.com/file/d/abc/view");
if (!svg.startsWith("<svg") || svg.includes("<script") || svg.includes("drive.google.com")) fail("qr leaked the url or is not local svg");
if (formatBytes(htmlBytes).includes("—")) fail("em dash in size");
if (driveClientConfigured("REPLACE_ME.apps.googleusercontent.com")) fail("placeholder looked configured");
if (driveClientConfigured("")) fail("empty client id");
if (!driveClientConfigured("123-abc.apps.googleusercontent.com")) fail("real client id hidden");

const desc = new Uint8Array(19);
desc.set(new TextEncoder().encode("OpusHead"), 0);
desc[8] = 1;
desc[9] = 1;
desc[10] = 56;
desc[11] = 1;
new DataView(desc.buffer).setUint32(12, 48000, true);
const packets = [];
for (let i = 0; i < 10; i += 1) packets.push({ timestampUs: i * 20000, data: Uint8Array.of(0xfc, 0xff, 0xfe) });
const webm = muxOpusWebm({ packets, description: desc, durationSec: 0.2 });
const text = Buffer.from(webm).toString("latin1");
if (webm[0] !== 0x1a || webm[1] !== 0x45 || webm[2] !== 0xdf || webm[3] !== 0xa3) fail("ebml magic");
if (!text.includes("webm") || !text.includes("A_OPUS") || !text.includes("OpusHead")) fail("webm tags missing");
console.log("save plan ok", formatBytes(htmlBytes), "per minute estimate");
