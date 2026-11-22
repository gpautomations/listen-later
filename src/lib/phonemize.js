// SPDX-License-Identifier: GPL-3.0-or-later
// Listen Later — text normalization + phonemization for Kokoro.
// Copyright (C) 2026 Growth Process Automation
//
// This program is free software: you can redistribute it and/or modify it under the terms of
// the GNU General Public License as published by the Free Software Foundation, either
// version 3 of the License, or (at your option) any later version. This program is
// distributed WITHOUT ANY WARRANTY; see the GNU General Public License (COPYING) for details.
//
// Normalization rules adapted from kokoro-js (Apache-2.0, (c) hexgrad / Xenova):
// https://github.com/hexgrad/kokoro (see THIRD_PARTY.md).
// Phonemes come from eSpeak NG 1.52.0 (GPL-3.0-or-later), built from the vendored source in
// third_party/espeak-ng/ into src/vendor/espeak-ng/espeakng.mjs.
import { phonemize as espeak } from "../vendor/espeak-ng/phonemizer.mjs";

function splitNum(match) {
  if (match.includes(".")) return match;
  if (match.includes(":")) {
    let [h, m] = match.split(":").map(Number);
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  let year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  let left = match.slice(0, 2);
  let right = parseInt(match.slice(2, 4), 10);
  let suffix = match.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}
function flipMoney(match) {
  const bill = match[0] === "$" ? "dollar" : "pound";
  if (isNaN(Number(match.slice(1)))) return `${match.slice(1)} ${bill}s`;
  if (!match.includes(".")) {
    let suffix = match.slice(1) === "1" ? "" : "s";
    return `${match.slice(1)} ${bill}${suffix}`;
  }
  const [b, c] = match.slice(1).split(".");
  const d = parseInt(c.padEnd(2, "0"), 10);
  let coins = match[0] === "$" ? (d === 1 ? "cent" : "cents") : d === 1 ? "penny" : "pence";
  return `${b} ${bill}${b === "1" ? "" : "s"} and ${d} ${coins}`;
}
function pointNum(match) {
  let [a, b] = match.split(".");
  return `${a} point ${b.split("").join(" ")}`;
}
function normalizeText(text) {
  return text
    .replace(/[‘’]/g, "'").replace(/«/g, "“").replace(/»/g, "”").replace(/[“”]/g, '"')
    .replace(/\(/g, "«").replace(/\)/g, "»")
    .replace(/[^\S \n]/g, " ").replace(/  +/, " ")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}
const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RE = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`, "g");
function splitPunct(text) {
  const out = []; let i = 0;
  for (const m of text.matchAll(PUNCT_RE)) {
    if (i < m.index) out.push({ match: false, text: text.slice(i, m.index) });
    if (m[0].length) out.push({ match: true, text: m[0] });
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ match: false, text: text.slice(i) });
  return out;
}

const cache = new Map();
export async function phonemize(text, lang = "a") {
  const key = lang + "|" + text;
  if (cache.has(key)) return cache.get(key);
  const norm = normalizeText(text);
  const parts = splitPunct(norm);
  const voice = lang === "a" ? "en-us" : "en";
  const ph = (await Promise.all(parts.map(async ({ match, text }) => (match ? text : (await espeak(text, voice)).join(" "))))).join("");
  let out = ph
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ").replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j").replace(/r/g, "ɹ").replace(/x/g, "k").replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (lang === "a") out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  out = out.trim();
  if (cache.size > 20000) cache.clear();
  cache.set(key, out);
  return out;
}
