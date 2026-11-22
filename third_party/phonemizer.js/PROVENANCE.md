# phonemizer.js — pinned source

- Upstream: https://github.com/xenova/phonemizer.js
- Commit: `6835144b7ee9043129222549c1ed2f6a27216278` ("Update to v1.2.1", 2025-01-16) — the `gitHead`
  recorded in the `phonemizer@1.2.1` npm package that kokoro-js depends on.
- License: Apache-2.0 (`LICENSE`, unmodified).

Files copied verbatim from that commit: `src/phonemizer.js`, `LICENSE`, `README.md`, `package.json`.

## What Listen Later ships

Listen Later does **not** ship phonemizer.js's prebuilt `src/espeakng.worker.js` / `data/espeakng.worker.data`.
That prebuilt eSpeak NG blob carries no version string and phonemizer.js has no build scripts for it, so
its exact eSpeak NG revision could not be determined. Instead we rebuild eSpeak NG ourselves from a pinned
release (see `../espeak-ng/README.md`) and use a small adapted copy of `src/phonemizer.js`
(`src/vendor/espeak-ng/phonemizer.mjs`, same `phonemize()` / `list_voices()` API) that loads our build.
