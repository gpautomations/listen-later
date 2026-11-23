# Listen Later: Chrome extension (v0.2.0)

Reads any article aloud **on the original page**. A small dark player appears bottom-right; press play and each word
lights up in place, in the site's own layout with its own images. The voice (Kokoro-82M) runs **inside your browser**:
no server, no paid API, nothing about the page is uploaded (the one exception is the optional "Send to my phone", which
posts only to a server address you configure yourself). Otherwise the only network use is a one-time model download from
huggingface.co, which is then cached by the browser.

Listen Later is free software under **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)). It bundles eSpeak NG
(GPL-3.0-or-later) built from the pinned source in [`third_party/espeak-ng/`](third_party/espeak-ng/); all third-party
components and their licenses are listed in [`THIRD_PARTY.md`](THIRD_PARTY.md).

## Install (Developer mode)
1. Download `listen-later-store-0.2.0.zip` from the [v0.2.0 release](https://github.com/gpautomations/listen-later/releases/tag/v0.2.0)
   (or build it, below) and unzip it into a folder.
2. In Chrome go to `chrome://extensions`, turn on **Developer mode** (top-right).
3. Click **Load unpacked** and pick that folder.
4. Open an article, e.g. https://www.notion.com/blog/steam-steel-and-infinite-minds-ai. Nothing from Listen Later runs yet.
   Click the Listen Later toolbar icon (or right-click the page and choose **Listen to this page**, or press `Alt+Shift+L`).
   The player shows up bottom-right.
5. Press play. The first time, the voice model downloads once (326 MB in High quality, 92 MB in Fast).
   After that, it starts in about 3 seconds.
6. Optional: right-click the toolbar icon > Options to enter your own Listen Later server for "Send to my phone"
   and test the connection. Chrome asks you to allow access to that address when you press Save.

Works in Chrome/Edge/Brave 116+.

## Using it
- **Turn it on**: toolbar icon, right-click **Listen to this page**, or `Alt+Shift+L`. Click the icon again to hide the player. Listen Later does not load on a page until you do this. In Options you can turn on **Always show on this site** for a site you name; Chrome asks before that site is allowed.
- **Play / pause**: big yellow button, or `Alt+Shift+P` while the player is open.
- **Skip**: next/previous sentence buttons (previous restarts the sentence if you're more than 1.5 s in).
- **Jump**: click any word in the article (outside links) to start reading from that sentence.
- **Speed** (in the gear menu): 0.8× to 2× (the voice is regenerated at that speed, so pitch stays natural).
- **Settings (gear)**: speed, voice and quality.
  - Voice: Heart (default), Bella, Nicole, Michael, Fenrir, Emma (UK), George (UK).
  - Quality: **High** (full fp32 Kokoro; default) or **Fast** (q8, 92 MB download, slightly less clear).
  All three are remembered between pages.
- **Send to my phone** (phone icon): sends the article's title, URL and cleaned text, split into chapters at its section
  headings, to your Listen Later server's `POST /api/ingest`. It shows up in your private podcast feed (`/feed.xml`) a few
  minutes later. A toast confirms success or explains the failure (for example, not on the home network). With no server
  set, the button asks you to add one in Options; nothing is sent until you do.
- **Save episode** (download icon): asks where to save one HTML file with the article text, its pictures, word timings and
  Opus audio inside (about 200 KB per minute of audio, plus the pictures; WAV only if Opus cannot be encoded). Chrome remembers the last folder.
  Open the file anytime, including offline. Nothing is uploaded unless you connect Google Drive, and that button
  stays hidden until a client id is set. A Drive save then shows the file link and a QR code. The optional phone server is not required.
- **Auto-scroll** follows the voice. Scroll yourself and it stops following; tap **Follow** to snap back.
- **×** hides the player (toolbar icon brings it back).

## How it works
- `content.js` is not declared in `content_scripts`. `background.js` injects it with `chrome.scripting.executeScript`
  only after the toolbar, context menu, or keyboard shortcut (temporary `activeTab` access), or on sites the user
  pinned with "Always show on this site" (a host permission Chrome asks for, plus a dynamic content script). It runs Mozilla Readability on a *clone* of the page to identify the article text, then matches those
  paragraphs/headings/list items back to the live page. Only text nodes inside those blocks get wrapped in
  `<span class="ll-w">` (links, images, figures, footnote markers and buttons are left alone). Wrapping happens when
  you first press play. Sentences are split per block. The player UI lives in a Shadow DOM so the page CSS can't break it.
- `background.js` (service worker): creates an **offscreen document** (MV3 service workers can't use WebGPU) and
  relays model-download progress to the tab.
- `offscreen.js`: transformers.js + ONNX Runtime Web, plus eSpeak NG 1.52.0 (compiled to WebAssembly from
  `third_party/espeak-ng/`) for text-to-phoneme conversion. Uses **WebGPU** when a real GPU adapter exists, otherwise
  **WASM (multi-threaded** via cross-origin isolation). Quality picks the weights: High = fp32, Fast = q8. The model is `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`,
  which also outputs **per-phoneme durations**. v2 phonemizes the **whole sentence** (like kokoro-js), which keeps
  natural stress and weak forms, then aligns the sentence's phoneme words back to the page's words (exact in most
  sentences; proportional when numbers or abbreviations expand). Word timings come from the model's own durations.
- Streaming: audio is generated sentence by sentence; sentence 1 plays while sentences 2 to 4 are generated in the background.
  Jumping, voice or speed changes cancel stale queued work.
- Audio plays in the page via Web Audio, so the page's CSP doesn't block it. v2 hands over lossless Float32 samples and runs
  the AudioContext at Kokoro's native 24 kHz, so there's no per-buffer resampling (Chrome resamples once, at the output
  device, with its high-quality resampler). Peaks are checked per sentence (measured max 0.74, no clipping) and NaN output
  is rejected instead of played.
- `background.js` also performs "Send to my phone": it posts with the optional host permission you grant for your
  server in Options, so the server needs **no CORS headers**.

## What changed in v0.2.0
- **Clearer voice.** Three causes found and fixed:
  1. v1 phonemized word by word, so every "the" and "a" got full, stressed pronunciation. v2 phonemizes whole sentences.
  2. v1 defaulted to fp16 on WASM, which produced all-NaN (silent) audio for about 1 sentence in 6 (3 of 17 in a test).
     fp16 is no longer used.
  3. v1 played 24 kHz buffers in a 48 kHz AudioContext (Chrome resamples those with simple interpolation) and quantized to
     16-bit. v2 uses a 24 kHz context and Float32.
- **Quality setting** (High / Fast), High by default.
- **Send to my phone** + Options page (server URL, test connection, quality).
- **Share listen link** + `#listen-later` invite with one-click play. (Removed after 0.2.0: it only copied the article URL. Save episode replaces it. The version number is still 0.2.0 until the next store upload.)
- Settings moved into a gear popover to keep the pill small.

## Measured on the build box (headless Chromium, WASM, 7 threads, no GPU), Notion "Steam, Steel, and Infinite Minds"
| | High (fp32, default) | Fast (q8) |
|---|---|---|
| Download | 326 MB | 92 MB |
| First audio, cold (fresh profile: download + load + first sentence) | 12.5 s | 8.2 s |
| First audio, warm (model cached, fresh browser) | 3.2 s | 4.6 s |
| Generation speed, real-time factor (lower is better) | 0.43 to 0.53 (about 2x faster than real time) | 1.09 to 1.16 (slower than real time) |
| "Buffering" gaps in 30 s of playback | 0 | 4 |
| Peak level | 0.74 | 0.65 |

On WASM, High is both clearer and faster than Fast, so it's the default on WASM too. Fast only saves download size and
memory. (The brief asked for Fast as the WASM default; the measurements above are why it isn't.) WebGPU speed on a real
GPU is untested here; WebGPU + fp32 was verified functionally on a software GPU.

Other v2 checks (all passing): player injects, 1,794 words wrapped with page text/links unchanged, highlighting advances,
next/pause/resume/click-to-jump work, Send to my phone posts the right payload to a mock server (5 chapters, real title,
source URL) and shows a success toast, an unreachable server shows a failure toast, the share link is copied to the
clipboard, and opening it shows the invite and starts audio in 1.2 s with one click. 0 extension console errors.

## Known limits
- Live `notion.com/a-new-shape-for-work` currently returns 404, so it was tested on the Wayback Machine copy of the same page.
- First play downloads the model (326 MB High, 92 MB Fast). Slow connections see a "Downloading voice NN%" status.
- On slower CPUs without WebGPU, generation may fall behind real time; the player shows "Buffering…" between sentences.
- Send to my phone only works where the browser can reach your server (same home network, or a VPN such as Tailscale). You do not need that server. Save episode keeps the audio in a file on your computer.
- Save episode uses the on-device Kokoro voice, so the first save may download the model (326 MB High, 92 MB Fast). Web Speech API audio cannot be recorded, so it is not used. Opus in the saved file measured 26.5 kbps (about 199 KB of audio per minute, before the HTML text) on Chromium, with word bursts landing within 1 ms of the original timeline after the encoder delay is trimmed. Pictures in the article are re-encoded into the file (WebP or JPEG, long edge at most 1280px) and counted in the size estimate before you continue. A picture the page will not let the browser read is skipped. A page that cannot show the folder picker falls back to Chrome's save dialog (`downloads` permission, `saveAs`). Google Drive upload is implemented but hidden while `oauth2.client_id` is `REPLACE_ME`. After a Drive upload the player shows the file's private link and a QR code drawn locally. Drive's preview and the iPhone Files preview (Quick Look) do not run the page. Opened from an http link, the same file played Opus audio and highlighted the tapped word in a mobile-sized Chromium window and in Playwright WebKit 27.2 (the engine family behind current Safari and Chrome on iOS). A `file://` URL did the same in Chromium. This machine has no iPhone, so Files and Quick Look were not run. Dropbox is not built: it would need its own app key, an OAuth token (PKCE), and `https://api.dropboxapi.com` plus `https://content.dropboxapi.com` host access.
- English only. Numbers, currencies and years are normalized; unusual abbreviations may be read literally.
- Pages that re-render their article text after load (some single-page apps) can drop the word spans; reload and press play again.
- Paywalled or login-only text is only read if it's visible in your browser. Iframes and PDFs aren't supported.
- Speed changes regenerate audio from the current sentence (a short pause).
- Safari/iPhone needs a separate Safari Web Extension inside an App Store app (not built).

## Build from source

Requirements: Node.js 20+ and Python 3.

```bash
npm ci --ignore-scripts   # --ignore-scripts skips onnxruntime-node's native download (not needed in the browser)
npm run build             # -> dist/        unpacked extension (generic, or with your local.config.json defaults)
npm run build:store       # -> dist-store/  Chrome Web Store build (always generic)
npm run package           # -> listen-later-extension.zip and store/listen-later-store-0.2.0.zip
```

Both packages contain `COPYING` (GPL v3 text) and `THIRD_PARTY.md`.

**Personal defaults (optional, never committed).** Copy `local.config.example.json` to `local.config.json` and set
`defaultServer` (and optionally `serverName`). `npm run build` then pre-fills that server in Options and adds host access
to it in `dist/manifest.json`. The store build ignores this file.

**eSpeak NG (Corresponding Source).** `src/vendor/espeak-ng/espeakng.mjs` is generated, and committed so a normal build
needs no C toolchain. To rebuild it from the vendored, checksummed eSpeak NG 1.52.0 source with Emscripten 3.1.74, see
[`third_party/espeak-ng/README.md`](third_party/espeak-ng/README.md) (`npm run build:espeak`).

Source layout:
- `src/`: `manifest.json`, `background.js`, `content.src.js`, `content.css`, `offscreen.html`, `offscreen.src.js`,
  `options.html`, `options.js`, `grant.html` (confirm "always show on this site"), `lib/episode.mjs` (saved read-along file),
  `lib/phonemize.js`, `vendor/espeak-ng/` (eSpeak NG build + `phonemizer.mjs` wrapper).
- `third_party/espeak-ng/`: eSpeak NG 1.52.0 source tarball, `SHA256SUMS`, patch, `build.sh`.
- `third_party/phonemizer.js/`: phonemizer.js source pinned at commit `6835144` (Apache-2.0), which our wrapper adapts.
- `store/`: Chrome Web Store listing draft, privacy policy, icon, promo tile, screenshots.
- `test/`: Playwright checks. `test/e2e-v2.mjs` (QUALITY=high|fast; runs a mock Listen Later server on 127.0.0.1:7778
  and maps `LL_TEST_HOST`, default `my-computer.local`, to it), `test/store-build-check.mjs`, `test/quality.mjs`,
  `test/dtypes.mjs`, `test/store-shots.mjs`.

## License

Copyright (C) 2026 Growth Process Automation.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed WITHOUT ANY WARRANTY. See [`LICENSE`](LICENSE) and [`THIRD_PARTY.md`](THIRD_PARTY.md).

Contact: scott@gpautomations.com
