# eSpeak NG — Corresponding Source for the bundled phonemizer

Listen Later converts text to phonemes with **eSpeak NG**, compiled to WebAssembly and bundled into the
extension's `offscreen.js`. eSpeak NG is licensed **GPL-3.0-or-later**; this directory is the complete
corresponding source for that binary.

| Item | Value |
|---|---|
| eSpeak NG release | **1.52.0** (tag `1.52.0`, commit `4870adfa25b1a32b4361592f1be8a40337c58d6c`) |
| Source | `espeak-ng-1.52.0.tar.gz` (vendored here, byte-for-byte as downloaded from `https://github.com/espeak-ng/espeak-ng/archive/refs/tags/1.52.0.tar.gz`) |
| Source checksum | see `SHA256SUMS` (`bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23`) |
| Patches | `patches/0001-glue-ipa-without-phoneme-separator.patch` (one line in `emscripten/espeakng_glue.cpp`) |
| Build script | `build.sh` (native data build, Emscripten library build, glue + link) |
| Toolchain | Emscripten **3.1.74** via emsdk; Debian 13 `build-essential autoconf automake libtool pkg-config` |
| Output | `src/vendor/espeak-ng/espeakng.mjs` (checksum in `src/vendor/espeak-ng/espeakng.mjs.sha256`) |
| Data embedded | `phontab phonindex phondata intonations en_dict` + all `lang/` and `voices/` files |

Licenses inside the tarball: `COPYING` (GPL-3.0), `COPYING.UCD` (Unicode data, used by the bundled
ucd-tools), `COPYING.APACHE`, `COPYING.BSD2` (Windows getopt only; not compiled into our build).

## Rebuild

```bash
# once: toolchain
sudo apt-get install -y build-essential autoconf automake libtool pkg-config
git clone https://github.com/emscripten-core/emsdk && cd emsdk
./emsdk install 3.1.74 && ./emsdk activate 3.1.74 && source ./emsdk_env.sh && cd -

# rebuild src/vendor/espeak-ng/espeakng.mjs, then the extension
npm run build:espeak
npm run build:all
```

## Why not phonemizer.js's prebuilt worker

`phonemizer@1.2.1` (xenova/phonemizer.js commit `6835144`, see `../phonemizer.js/`) ships a prebuilt
eSpeak NG worker without recording which eSpeak NG revision or build script produced it, so we could not
point to its exact source. We rebuilt from the pinned 1.52.0 release instead and verified the output:
on a 20-case comparison (10 sentences × `en-us`/`en`), 18 phoneme strings were identical to phonemizer@1.2.1;
the 2 differences are en-us `oː`→`ɔː` before r ("four", "Kokoro"), an upstream dictionary change.

## Reproducibility

Two clean runs of `build.sh` (separate work directories, Debian 13, Emscripten 3.1.74) produced byte-identical output:
`espeakng.mjs` sha256 `9c994e6a4374a2f073aefea4749b6a55ee41ca8ee064d6d9eeff5b1a0469102a`.
