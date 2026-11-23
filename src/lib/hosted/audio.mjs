// SPDX-License-Identifier: GPL-3.0-or-later
// Opus in WebM, not Ogg. Safari 18.4+ plays both, but Ogg Opus reports the wrong duration,
// so word taps would land late. If the encoder is missing, fall back to 16-bit WAV.
import { Muxer, ArrayBufferTarget } from "webm-muxer";
import { encodeWav } from "../episode.mjs";

export function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const outLen = Math.max(1, Math.round(input.length * toRate / fromRate));
  const out = new Float32Array(outLen);
  const scale = fromRate / toRate;
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const x = i * scale;
    const i0 = Math.min(last, Math.floor(x));
    const i1 = Math.min(last, i0 + 1);
    const t = x - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

function wavResult(samples, sampleRate) {
  return { bytes: encodeWav(samples, sampleRate), mime: "audio/wav", ext: "wav" };
}

export async function encodeEpisodeAudio(samples, sampleRate) {
  try {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return wavResult(samples, sampleRate);
    const rate = 48000;
    const pcm = resampleLinear(samples, sampleRate, rate);
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      audio: { codec: "A_OPUS", sampleRate: rate, numberOfChannels: 1 },
      firstTimestampBehavior: "offset",
    });
    let failed = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        try { muxer.addAudioChunk(chunk, meta); } catch (err) { failed = err; }
      },
      error: (err) => { failed = err; },
    });
    encoder.configure({ codec: "opus", sampleRate: rate, numberOfChannels: 1, bitrate: 24000 });
    const frame = rate;
    for (let offset = 0; offset < pcm.length; offset += frame) {
      const slice = pcm.subarray(offset, Math.min(pcm.length, offset + frame));
      const copy = new Float32Array(slice.length);
      copy.set(slice);
      const data = new AudioData({
        format: "f32",
        sampleRate: rate,
        numberOfFrames: slice.length,
        numberOfChannels: 1,
        timestamp: Math.round(offset / rate * 1e6),
        data: copy.buffer,
      });
      encoder.encode(data);
      data.close();
    }
    await encoder.flush();
    if (failed) throw failed;
    muxer.finalize();
    const bytes = new Uint8Array(target.buffer);
    if (bytes.byteLength < 32 || bytes[0] !== 0x1a) throw new Error("opus file was empty");
    return { bytes, mime: "audio/webm", ext: "webm" };
  } catch (e) {
    return wavResult(samples, sampleRate);
  }
}
