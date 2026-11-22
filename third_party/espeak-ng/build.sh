#!/usr/bin/env bash
# Rebuilds src/vendor/espeak-ng/espeakng.mjs (the eSpeak NG phonemizer that ships in
# the extension) from the pinned, vendored eSpeak NG 1.52.0 source in this directory.
#
# Copyright (C) 2026 Growth Process Automation. GPL-3.0-or-later.
#
# Requirements (tested on Debian 13): build-essential autoconf automake libtool pkg-config,
# python3, and emsdk with Emscripten 3.1.74 activated:
#   git clone https://github.com/emscripten-core/emsdk && cd emsdk
#   ./emsdk install 3.1.74 && ./emsdk activate 3.1.74 && source ./emsdk_env.sh
#
# Steps follow espeak-ng/emscripten/README.md from the same tag (native build for the
# data files, then the library with emconfigure/emmake, then the upstream glue code),
# with two packaging differences from the upstream emscripten/Makefile:
#   * output is a single ES module with real WebAssembly embedded (-sMODULARIZE -sEXPORT_ES6
#     -sSINGLE_FILE) instead of a classic Web Worker script with WASM=0;
#   * only the English dictionary is embedded, plus the shared phoneme tables and all
#     lang/voices files (the same subset phonemizer.js 1.2.1 shipped).
# The upstream glue (espeakng_glue.cpp / .idl / post.js) is used with one patch,
# patches/0001-glue-ipa-without-phoneme-separator.patch: synth_ipa_ writes the phonemes of a
# word contiguously (no ' ' between phonemes), which is the output format the Kokoro
# tokenizer expects and what phonemizer.js 1.2.1 produced.
# Build-flag workaround: newer Emscripten (musl) declares isw*() in <wchar.h>, which clashes
# with eSpeak NG's src/include/compat/wctype.h macros (#define iswupper ucd_isupper, tolower ucd_tolower ...).
# Force-including <ctype.h>/<wchar.h>/<wctype.h> first (CFLAGS below) lets the declarations land before
# the macros. No source file is changed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VER=1.52.0
TARBALL="$HERE/espeak-ng-$VER.tar.gz"
OUT="$ROOT/src/vendor/espeak-ng"
WORK="${WORK:-$(mktemp -d)}"
JOBS="${JOBS:-$(nproc)}"

command -v emcc >/dev/null || { echo "emcc not found: activate emsdk 3.1.74 first" >&2; exit 1; }
emcc --version | head -1 | grep -q " 3\.1\.74 " || echo "warning: expected Emscripten 3.1.74 (got: $(emcc --version | head -1))" >&2
(cd "$HERE" && sha256sum -c SHA256SUMS --ignore-missing)

echo "== work dir: $WORK"
rm -rf "$WORK/native" "$WORK/wasm"; mkdir -p "$WORK/native" "$WORK/wasm"
tar -xzf "$TARBALL" -C "$WORK/native" --strip-components=1
tar -xzf "$TARBALL" -C "$WORK/wasm" --strip-components=1
for p in "$HERE"/patches/*.patch; do patch -d "$WORK/wasm" -p1 --no-backup-if-mismatch < "$p"; done
CONF=(--prefix=/usr --without-async --without-mbrola --without-sonic --without-pcaudiolib --without-speechplayer)

echo "== 1/3 native build (compiles phoneme tables + English dictionary)"
( cd "$WORK/native" && ./autogen.sh >/dev/null 2>&1 && ./configure "${CONF[@]}" >/dev/null && make -j"$JOBS" src/espeak-ng >/dev/null && make en >/dev/null )

echo "== 2/3 Emscripten build of libespeak-ng"
( cd "$WORK/wasm" && ./autogen.sh >/dev/null 2>&1 && CFLAGS="-O3 -include ctype.h -include wchar.h -include wctype.h" CXXFLAGS="-O3" emconfigure ./configure "${CONF[@]}" --disable-shared --enable-static >/dev/null && emmake make -j"$JOBS" src/libespeak-ng.la >/dev/null )

echo "== 3/3 glue + link"
DATA="$WORK/data"; rm -rf "$DATA"; mkdir -p "$DATA"
for f in phontab phonindex phondata intonations en_dict; do cp "$WORK/native/espeak-ng-data/$f" "$DATA/"; done
cp -r "$WORK/native/espeak-ng-data/lang" "$WORK/native/espeak-ng-data/voices" "$DATA/"
cd "$WORK/wasm/emscripten"
python3 "$EMSDK/upstream/emscripten/tools/webidl_binder.py" espeakng_glue.idl glue
em++ -O3 -DESPEAK_DATA_PATH=\"/usr/share/espeak-ng-data\" -I ./ -I ../ -I ../src/include/espeak-ng -c espeakng_glue.cpp -o espeakng_glue.o
mkdir -p "$OUT"
em++ -O3 espeakng_glue.o ../src/.libs/libespeak-ng.a \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createESpeakNG -sSINGLE_FILE=1 -sWASM=1 \
  -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1 -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS=FS,addFunction,removeFunction,getValue \
  --embed-file "$DATA@/usr/share/espeak-ng-data" \
  --post-js glue.js --post-js post.js \
  -o "$OUT/espeakng.mjs"
cd "$OUT" && sha256sum espeakng.mjs | tee espeakng.mjs.sha256
echo "built $OUT/espeakng.mjs"
