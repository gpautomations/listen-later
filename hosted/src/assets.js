// SPDX-License-Identifier: GPL-3.0-or-later
// Static player assets. Served from this origin so episode HTML needs no inline script.

export const PLAYER_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #fafaf9;
  color: #1c1c1e;
  font: 1.125rem/1.6 Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif;
}
header, article, footer { max-width: 40rem; margin: 0 auto; padding-left: 1.15rem; padding-right: 1.15rem; }
header { padding-top: 1.15rem; }
h1 { font: 600 1.45rem/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0 0 0.7rem; }
.source {
  border: 1px solid #e4e4e7;
  background: #fff;
  border-radius: 12px;
  padding: 0.85rem 1rem;
  margin: 0 0 1rem;
  font: 0.95rem/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.kicker { margin: 0 0 0.25rem; font-weight: 700; }
.source p { margin: 0.35rem 0; }
.origin {
  display: inline-block;
  margin-top: 0.2rem;
  font-weight: 700;
  color: #0b57d0;
}
.url { color: #444; overflow-wrap: anywhere; font-size: 0.85rem; }
.report { color: #0b57d0; }
article { padding-bottom: 0.5rem; }
article p { margin: 0 0 1rem; }
article img { display: block; max-width: 100%; height: auto; margin: 0 0 1rem; border-radius: 8px; }
span[data-s] { border-radius: 0.2rem; cursor: pointer; }
span[data-s]:hover { background: rgba(255, 190, 0, 0.28); }
span.on { background: #ffbe00; color: #111; }
.resume {
  max-width: 40rem;
  margin: 0 auto 0.6rem;
  padding: 0 1.15rem;
  font: 0.9rem/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #444;
}
.resume button {
  margin-left: 0.4rem;
  border: 0;
  background: transparent;
  color: #0b57d0;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  padding: 0.2rem;
}
.bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  background: #121214;
  padding: 0.55rem 0.75rem calc(0.55rem + env(safe-area-inset-bottom));
}
.bar audio { display: block; width: min(40rem, 100%); height: 48px; margin: 0 auto; }
footer {
  padding-top: 0.4rem;
  padding-bottom: calc(6.5rem + env(safe-area-inset-bottom));
  color: #555;
  font: 0.85rem/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  body { background: #161618; color: #f2f2f4; }
  .source { background: #222226; border-color: #34343a; }
  .url, footer, .resume { color: #c4c4cc; }
  .origin, .report, .resume button { color: #9ec1ff; }
}
`;

export const PLAYER_JS = `
"use strict";
(function () {
  var dataEl = document.getElementById("episode");
  var audio = document.getElementById("audio");
  var resume = document.getElementById("resume");
  var resumeText = document.getElementById("resume-text");
  var startOver = document.getElementById("start-over");
  if (!dataEl || !audio) return;
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var words = [].slice.call(document.querySelectorAll("[data-s]"));
  var key = "ll-hosted-pos:" + (data.id || "");
  var current = -1;
  var restored = false;

  function findWord(t) {
    var lo = 0, hi = words.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (+words[mid].getAttribute("data-s") <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (ans < 0) return -1;
    if (t >= +words[ans].getAttribute("data-e")) return -1;
    return ans;
  }
  function tick() {
    var i = findWord(audio.currentTime || 0);
    if (i === current) return;
    if (current >= 0) words[current].classList.remove("on");
    current = i;
    if (i < 0) return;
    words[i].classList.add("on");
    var r = words[i].getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 90) {
      words[i].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  function clock(sec) {
    var s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function readPos() {
    try { return Number(localStorage.getItem(key) || 0); } catch (e) { return 0; }
  }
  function writePos() {
    try {
      var t = audio.currentTime || 0;
      if (t > 1 && (!audio.duration || t < audio.duration - 1)) localStorage.setItem(key, String(t));
      else localStorage.removeItem(key);
    } catch (e) {}
  }
  function positionState() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    var pos = Math.min(Math.max(0, audio.currentTime || 0), audio.duration);
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: pos });
    } catch (e) {}
  }
  audio.addEventListener("timeupdate", function () { tick(); positionState(); writePos(); });
  audio.addEventListener("seeked", tick);
  audio.addEventListener("play", function () {
    tick();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  });
  audio.addEventListener("pause", function () {
    writePos();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  });
  window.addEventListener("pagehide", writePos);
  words.forEach(function (word) {
    word.addEventListener("click", function () {
      audio.currentTime = +word.getAttribute("data-s") || 0;
      var played = audio.play();
      if (played && played.catch) played.catch(function () {});
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    if (e.target && e.target.closest && e.target.closest("a,button,input,textarea")) return;
    e.preventDefault();
    if (audio.paused) audio.play(); else audio.pause();
  });
  audio.addEventListener("loadedmetadata", function () {
    if (restored) return;
    restored = true;
    var t = readPos();
    if (t > 2 && isFinite(audio.duration) && t < audio.duration - 2) {
      audio.currentTime = t;
      if (resume && resumeText) {
        resumeText.textContent = "Back at " + clock(t) + ".";
        resume.hidden = false;
      }
    }
    positionState();
    setupSession();
  });
  if (startOver) startOver.addEventListener("click", function () {
    audio.currentTime = 0;
    try { localStorage.removeItem(key); } catch (e) {}
    if (resume) resume.hidden = true;
  });
  function setupSession() {
    if (!("mediaSession" in navigator)) return;
    var title = data.title || document.title || "Article";
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: title, artist: "Listen Later", album: "Personal reading copy" });
    } catch (e) {}
    var actions = {
      play: function () { audio.play(); },
      pause: function () { audio.pause(); },
      seekbackward: function (d) { audio.currentTime = Math.max(0, (audio.currentTime || 0) - ((d && d.seekOffset) || 10)); },
      seekforward: function (d) {
        var dur = isFinite(audio.duration) ? audio.duration : 1e9;
        audio.currentTime = Math.min(dur, (audio.currentTime || 0) + ((d && d.seekOffset) || 10));
      },
      seekto: function (d) { if (d && typeof d.seekTime === "number") audio.currentTime = d.seekTime; }
    };
    Object.keys(actions).forEach(function (name) {
      try { navigator.mediaSession.setActionHandler(name, actions[name]); } catch (e) {}
    });
  }
})();
`;
