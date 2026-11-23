// SPDX-License-Identifier: GPL-3.0-or-later
// HTML for private episode pages. User text is escaped. The player script is a static file.

import { cleanEmail } from "./http.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function shell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/player.css">
</head>
<body>
${body}
</body>
</html>
`;
}

export function renderHome({ abuseEmail }) {
  const email = cleanEmail(abuseEmail);
  return shell({
    title: "Listen Later",
    body: `<header>
  <h1>Listen Later</h1>
  <aside class="source">
    <p class="kicker">Private read-along links</p>
    <p>This address serves reading copies a person saved for themselves. There is no public catalog, no search, and no list of accounts.</p>
    <p>A link opens only when someone who has it opens it. Personal use only. This is not a republishing site.</p>
    <p><a class="report" href="mailto:${esc(email)}?subject=Listen%20Later%20problem">Report a problem</a></p>
  </aside>
</header>`,
  });
}

export function renderEpisode(stored, { abuseEmail }) {
  const email = cleanEmail(abuseEmail);
  const blocks = (stored.blocks || []).map((block) => {
    if (block.type === "img") {
      const name = encodeURIComponent(block.name);
      return `<img src="/e/${stored.id}/i/${name}" alt="${esc(block.alt || "")}">`;
    }
    const words = (block.words || []).map((word) => {
      return `<span data-s="${Number(word.start).toFixed(3)}" data-e="${Number(word.end).toFixed(3)}">${esc(word.text)}</span>`;
    }).join(" ");
    return `<p>${words}</p>`;
  }).join("\n");
  const source = stored.sourceUrl || "";
  const publicData = {
    id: stored.id,
    title: stored.title,
    durationSec: stored.durationSec,
  };
  const subject = encodeURIComponent(`Listen Later episode ${stored.id}`);
  return shell({
    title: stored.title || "Article",
    body: `<header>
  <h1>${esc(stored.title || "Article")}</h1>
  <aside class="source">
    <p class="kicker">Personal reading copy</p>
    <p>Saved with Listen Later for private listening. This page is not a public copy of the article.</p>
    <p><a class="origin" href="${esc(source)}" rel="noreferrer noopener">Original article</a></p>
    <p class="url">${esc(source)}</p>
    <p><a class="report" href="mailto:${esc(email)}?subject=${subject}">Report a problem</a></p>
  </aside>
</header>
<p class="resume" id="resume" hidden><span id="resume-text"></span> <button type="button" id="start-over">Start over</button></p>
<div class="bar"><audio id="audio" controls playsinline preload="metadata" src="/e/${stored.id}/audio"></audio></div>
<article>
${blocks || "<p>No article text.</p>"}
</article>
<footer>Length ${clock(stored.durationSec)}. ${esc(stored.voiceLabel || "Kokoro")} voice, generated on the reader's computer. Tap a word to jump there. Press space to play or pause. This private link is the only way to open this episode.</footer>
<script type="application/json" id="episode">${safeJson(publicData)}</script>
<script src="/player.js" defer></script>`,
  });
}

export function renderMissing() {
  return shell({
    title: "Episode not found",
    body: `<header><h1>Episode not found</h1><aside class="source"><p>This link does not open an episode. It may have been deleted.</p></aside></header>`,
  });
}
