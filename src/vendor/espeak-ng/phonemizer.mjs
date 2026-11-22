// Drop-in replacement for the `phonemizer` npm package (v1.2.1) API, backed by our own
// Emscripten build of eSpeak NG 1.52.0 (./espeakng.mjs, rebuilt by
// third_party/espeak-ng/build.sh from the vendored source tarball).
//
// Adapted from phonemizer.js src/phonemizer.js at commit 6835144
// (https://github.com/xenova/phonemizer.js), Copyright Xenova, Apache License 2.0.
// Changes: load the ES-module build via its factory instead of the prebuilt worker script.
// Modifications Copyright (C) 2026 Growth Process Automation, distributed as part of
// Listen Later under GPL-3.0-or-later.
import createESpeakNG from "./espeakng.mjs";

const workerPromise = createESpeakNG().then((Module) => new Module.eSpeakNGWorker());

const SUPPORTED_LANGUAGES = ["en"];

const initCache = workerPromise.then((worker) => {
  const voices = worker
    .list_voices()
    .map(({ name, identifier, languages }) => ({
      name,
      identifier,
      languages: languages.filter((lang) => SUPPORTED_LANGUAGES.includes(lang.name.split("-")[0])),
    }))
    .filter((voice) => voice.languages.length > 0);
  const identifiers = new Set();
  for (const voice of voices) {
    identifiers.add(voice.identifier);
    for (const lang of voice.languages) identifiers.add(lang.name);
  }
  return { voices, identifiers };
});

/** List the available voices for the specified language. */
export const list_voices = async (language) => {
  const { voices } = await initCache;
  if (!language) return voices;
  const base = language.split("-")[0];
  return voices.filter((voice) =>
    voice.languages.some((lang) => lang.name === base || lang.name.startsWith(base + "-")),
  );
};

/** Text to IPA phonemes (one string per clause), same contract as phonemizer@1.2.1. */
export const phonemize = async (text, language = "en-us") => {
  const worker = await workerPromise;
  const { identifiers } = await initCache;
  if (!identifiers.has(language)) {
    throw new Error(`Invalid language identifier: "${language}". Should be one of: ${Array.from(identifiers).sort().join(", ")}.`);
  }
  worker.set_voice(language);
  return worker.synthesize_ipa(text).ipa?.split("\n").filter((x) => x.length > 0) ?? [];
};
