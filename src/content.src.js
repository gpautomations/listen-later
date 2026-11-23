// Listen Later content script: finds the article, wraps its words in place, and drives a floating player.
// Injected only after the user turns the page on (toolbar, menu, shortcut, or a site they pinned).
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { buildEpisodeHtml, bytesToBase64, concatFloat32, encodeWav, episodeFilename, float32FromBase64 } from "./lib/episode.mjs";
import { attachHostedSave } from "./lib/hosted/player.mjs";

(() => {
  if (window.__listenLater) return;
  window.__listenLater = true;

  const VOICES = [
    ["af_heart", "Heart (US F)"], ["af_bella", "Bella (US F)"], ["af_nicole", "Nicole (US F)"],
    ["am_michael", "Michael (US M)"], ["am_fenrir", "Fenrir (US M)"], ["bf_emma", "Emma (UK F)"], ["bm_george", "George (UK M)"],
  ];
  const SPEEDS = [0.8, 1, 1.15, 1.25, 1.5, 1.75, 2];
  const BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, pre, dd, dt, td, th";
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "BUTTON", "TEXTAREA", "SELECT", "OPTION", "INPUT", "SUP", "MATH", "CANVAS", "IFRAME"]);
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const ABBR = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|inc|ltd|co|corp|e\.g|i\.e|u\.s|no|fig|approx|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;

  // ---------- article detection ----------
  function detectArticle() {
    let art = null;
    try { art = new Readability(document.cloneNode(true), { charThreshold: 400 }).parse(); } catch (e) { console.warn("[ListenLater] Readability failed", e); }
    if (!art || !art.content) return null;
    const rdoc = new DOMParser().parseFromString(art.content, "text/html");
    const keys = new Set(), prefixes = new Set();
    rdoc.querySelectorAll(BLOCK_SEL).forEach((el) => { const t = norm(el.textContent); if (t.length > 1) { keys.add(t); if (t.length > 60) prefixes.add(t.slice(0, 60)); } });
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    let blocks = [...document.body.querySelectorAll(BLOCK_SEL)].filter((el) => {
      if (el.closest("#listen-later-host")) return false;
      const t = norm(el.textContent);
      return t.length > 1 && (keys.has(t) || (t.length > 60 && prefixes.has(t.slice(0, 60)))) && visible(el);
    });
    blocks = blocks.filter((el) => !blocks.some((o) => o !== el && el.contains(o))); // innermost only
    if (!blocks.length) return null;
    // main content node = lowest common ancestor of matched blocks
    let root = blocks[0].parentElement;
    while (root && !blocks.every((b) => root.contains(b))) root = root.parentElement;
    // title: page H1 matching the Readability title, if it sits before the body text
    const title = norm(art.title);
    const h1 = [...document.querySelectorAll("h1")].find((h) => visible(h) && title && (norm(h.textContent) === title || title.startsWith(norm(h.textContent))));
    if (h1 && !blocks.includes(h1) && (h1.compareDocumentPosition(blocks[0]) & Node.DOCUMENT_POSITION_FOLLOWING)) blocks.unshift(h1);
    return { blocks, root, title: art.title, chars: art.length };
  }

  // ---------- word wrapping (in place, live DOM) ----------
  function wrapBlocks(blocks) {
    const units = []; // spoken words: { spans: [], text }
    const blockStarts = [];
    for (const block of blocks) {
      blockStarts.push(units.length);
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          for (let p = n.parentElement; p && p !== block.parentElement; p = p.parentElement) {
            if (SKIP_TAGS.has(p.tagName.toUpperCase()) || p.classList?.contains("ll-w")) return NodeFilter.FILTER_REJECT;
            if (p.getAttribute && p.getAttribute("aria-hidden") === "true") return NodeFilter.FILTER_REJECT;
          }
          return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      let joinPrev = false; // previous token touched the end of its text node with no whitespace
      const blockFirst = units.length;
      for (const node of nodes) {
        const text = node.nodeValue;
        const parts = text.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        parts.forEach((part, i) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); joinPrev = false; return; }
          const span = document.createElement("span");
          span.className = "ll-w";
          span.textContent = part;
          frag.appendChild(span);
          if (joinPrev && i === 0 && units.length > blockFirst) { const u = units[units.length - 1]; u.spans.push(span); u.text += part; }
          else units.push({ spans: [span], text: part });
          joinPrev = i === parts.length - 1;
        });
        node.parentNode.replaceChild(frag, node);
      }
    }
    units.forEach((u, i) => u.spans.forEach((s) => (s.dataset.llw = i)));
    return { units, blockStarts };
  }

  function buildSentences(units, blockStarts) {
    const sentences = [];
    const blockEnd = new Set(blockStarts.slice(1).map((s) => s - 1)); blockEnd.add(units.length - 1);
    let cur = [];
    const flush = () => { if (cur.length) { sentences.push(cur); cur = []; } };
    for (let i = 0; i < units.length; i++) {
      cur.push(i);
      const t = units[i].text;
      const end = /[.!?…]["'”’)\]]*$/.test(t) && !ABBR.test(t) && !/^[A-Z]\.$/.test(t);
      if (end || blockEnd.has(i)) { flush(); continue; }
      if (cur.length >= 45) {
        // break long run-ons at the last clause boundary to keep first-audio latency low
        let k = cur.length - 1; while (k > 15 && !/[,;:—–]$/.test(units[cur[k]].text)) k--;
        if (k > 15) { const rest = cur.slice(k + 1); cur = cur.slice(0, k + 1); flush(); cur = rest; } else flush();
      }
    }
    flush();
    for (let s = 0; s < sentences.length; s++) for (const u of sentences[s]) units[u].sentence = s;
    return sentences;
  }

  // ---------- UI (shadow DOM pill) ----------
  const host = document.createElement("div");
  host.id = "listen-later-host";
  host.style.cssText = "all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; display: none;";
  const shadow = host.attachShadow({ mode: "open" });
  const I = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    load: '<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6z"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".9s" repeatCount="indefinite"/></path></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zm10-12h2v12h-2z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M16 1H8a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 18H8V4h8v15zm-4 3a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 0 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L11 12.59V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.9a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  };
  shadow.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; color: #f2f2f2; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    .pill { background: rgba(18,18,20,.94); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,.08);
      border-radius: 999px; padding: 6px 8px 6px 6px; display: flex; align-items: center; gap: 2px;
      box-shadow: 0 8px 28px rgba(0,0,0,.35), 0 1px 3px rgba(0,0,0,.3); user-select: none; }
    button { all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #ddd; }
    button:hover, button[aria-expanded="true"] { background: rgba(255,255,255,.1); color: #fff; }
    button:focus-visible { outline: 2px solid #ffbe00; outline-offset: 1px; }
    button.play { width: 38px; height: 38px; background: #ffbe00; color: #111; margin-right: 2px; }
    button.play:hover { background: #ffd24d; color: #111; }
    button.follow { width: auto; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 12px; background: rgba(255,190,0,.18); color: #ffd24d; display: none; }
    button.follow.show { display: grid; }
    button.always { width: auto; height: auto; grid-column: 1 / -1; justify-self: start; border-radius: 8px; padding: 6px 10px; font-size: 12px; background: rgba(255,255,255,.08); color: #eee; }
    button.always:hover { background: rgba(255,255,255,.14); }
    button:disabled { opacity: .45; cursor: default; }
    svg { width: 16px; height: 16px; fill: currentColor; }
    button.play svg { width: 18px; height: 18px; }
    .status { min-width: 86px; max-width: 150px; padding: 0 6px; font-size: 12px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
    .sep { width: 1px; height: 18px; background: rgba(255,255,255,.12); margin: 0 4px; }
    .close { width: 24px; height: 24px; color: #888; }
    .close svg { width: 12px; height: 12px; }
    .card { background: rgba(18,18,20,.96); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 12px 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,.35); max-width: 330px; }
    .settings { display: none; min-width: 240px; }
    .settings.show { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; align-items: center; }
    .settings label { font-size: 12px; color: #aaa; }
    select { all: unset; cursor: pointer; font-size: 12px; color: #eee; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,.08); }
    select:hover { background: rgba(255,255,255,.14); }
    option { color: #111; background: #fff; }
    .hint { grid-column: 1 / -1; font-size: 11px; color: #888; }
    .toast { display: none; font-size: 12.5px; }
    .toast.show { display: block; }
    .toast.ok { border-color: rgba(80,200,120,.45); }
    .toast.err { border-color: rgba(255,90,90,.5); }
    .toast b { color: #fff; }
  </style>
  <div class="wrap" role="region" aria-label="Listen Later player">
    <div class="card toast" role="status" aria-live="polite"></div>
    <div class="card settings">
      <label for="ll-speed">Speed</label><select id="ll-speed" class="speed">${SPEEDS.map((s) => `<option value="${s}">${s}×</option>`).join("")}</select>
      <label for="ll-voice">Voice</label><select id="ll-voice" class="voice">${VOICES.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select>
      <label for="ll-quality">Quality</label><select id="ll-quality" class="quality"><option value="high">High (full model)</option><option value="fast">Fast (smaller download)</option></select>
      <div class="hint qhint">High uses the full Kokoro model (326 MB, downloaded once). Fast uses a 92 MB version that sounds slightly less clear.</div>
      <button class="always" type="button" title="Show the player automatically whenever you visit this site.">Always show on this site</button>
    </div>
    <div class="pill">
      <button class="play" title="Play (Alt+Shift+P)" aria-label="Play">${I.play}</button>
      <button class="prev" title="Previous sentence" aria-label="Previous sentence">${I.prev}</button>
      <button class="next" title="Next sentence" aria-label="Next sentence">${I.next}</button>
      <div class="status">Listen</div>
      <button class="follow" title="Scroll back to the voice">Follow</button>
      <div class="sep"></div>
      <button class="phone" title="Send to my phone (${__SERVER_LABEL__})" aria-label="Send to my phone">${I.phone}</button>
      <button class="save" title="Save episode: download a read-along page with the audio inside" aria-label="Save episode">${I.save}</button>
      <button class="gear" title="Speed, voice, quality" aria-label="Settings" aria-expanded="false">${I.gear}</button>
      <button class="close" title="Hide player" aria-label="Hide player">${I.close}</button>
    </div>
  </div>`;
  const $ = (s) => shadow.querySelector(s);
  shadow.querySelector(".speed").value = "1";
  const ui = { play: $(".play"), prev: $(".prev"), next: $(".next"), status: $(".status"), follow: $(".follow"), speed: $(".speed"), voice: $(".voice"), quality: $(".quality"),
    close: $(".close"), phone: $(".phone"), save: $(".save"), always: $(".always"), gear: $(".gear"), settings: $(".settings"), toast: $(".toast") };
  const ICON_PLAY = I.play, ICON_PAUSE = I.pause, ICON_LOAD = I.load;
  let toastTimer = 0;
  function toast(html, kind = "ok", ms = 6000) {
    ui.toast.innerHTML = html; ui.toast.className = `card toast show ${kind}`;
    host.setAttribute("data-toast", kind + ": " + ui.toast.textContent);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove("show"), ms);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  ui.gear.onclick = () => { const show = !ui.settings.classList.contains("show"); ui.settings.classList.toggle("show", show); ui.gear.setAttribute("aria-expanded", String(show)); };

  // ---------- state ----------
  const S = {
    article: null, units: null, sentences: null, blockStarts: null, prepared: false, saving: false,
    cur: 0, playing: false, loading: false, epoch: 1, voice: "af_heart", speed: 1, quality: "high", follow: true,
    ctx: null, source: null, startAt: 0, times: null, activeWord: -1, activeSent: -1,
    cache: new Map(), metrics: { firstAudioMs: null, playClickedAt: 0, sentences: [] }, modelReady: false, raf: 0,
  };
  const setAttr = (k, v) => host.setAttribute("data-" + k, String(v)); // exposes state for tests

  function setStatus(t) { ui.status.textContent = t; setAttr("status", t); }
  function setPlayIcon() {
    ui.play.innerHTML = S.loading ? ICON_LOAD : S.playing ? ICON_PAUSE : ICON_PLAY;
    ui.play.setAttribute("aria-label", S.playing ? "Pause" : "Play");
    setAttr("state", S.loading ? "loading" : S.playing ? "playing" : "paused");
  }

  function prepare() {
    if (S.prepared) return true;
    const t0 = performance.now();
    const art = detectArticle() || S.article;
    if (!art) { setStatus("No article found"); return false; }
    const { units, blockStarts } = wrapBlocks(art.blocks);
    S.units = units; S.blockStarts = blockStarts; S.sentences = buildSentences(units, blockStarts); S.prepared = true;
    document.documentElement.classList.add("ll-on");
    setAttr("words", units.length); setAttr("sentences", S.sentences.length); setAttr("blocks", art.blocks.length);
    setAttr("prepare-ms", Math.round(performance.now() - t0));
    return true;
  }

  // ---------- engine messaging ----------
  async function send(msg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ok = await chrome.runtime.sendMessage({ type: "ensure-engine" });
      if (!ok?.ok) throw new Error(ok?.error || "engine unavailable");
      const r = await chrome.runtime.sendMessage({ target: "offscreen", ...msg });
      if (r !== undefined) return r;
    }
    throw new Error("engine did not respond");
  }

  function decode(r) {
    const bin = atob(r.f32); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Lossless Float32 at the model's native 24 kHz; the AudioContext also runs at 24 kHz, so no per-buffer
    // (linear-interpolation) resampling happens. Chrome resamples once at the output device with a high-quality resampler.
    const f32 = new Float32Array(bytes.buffer);
    const buf = S.ctx.createBuffer(1, f32.length, r.sampleRate);
    buf.copyToChannel(f32, 0);
    return buf;
  }

  function request(idx) {
    const key = `${idx}|${S.voice}|${S.speed}|${S.quality}`;
    if (S.cache.has(key)) return S.cache.get(key);
    const words = S.sentences[idx].map((u) => S.units[u].text);
    const p = send({ type: "synth", words, voice: S.voice, speed: S.speed, quality: S.quality, epoch: S.epoch }).then((r) => {
      if (!r.ok) { S.cache.delete(key); if (r.stale) return null; throw new Error(r.error); }
      S.metrics.sentences.push({ idx, secs: +r.secs.toFixed(2), genMs: r.genMs, rtf: r.rtf, device: r.device });
      setAttr("device", r.device); setAttr("engine", `${r.device}/${r.dtype}`); setAttr("peak", Math.max(+(host.dataset.peak || 0), r.peak));
      const g = S.metrics.sentences; const gen = g.reduce((a, b) => a + b.genMs, 0) / 1000, aud = g.reduce((a, b) => a + b.secs, 0);
      setAttr("rtf", (gen / aud).toFixed(3)); setAttr("generated", g.length);
      return { buffer: decode(r), times: r.times };
    }).catch((e) => { S.cache.delete(key); throw e; });
    S.cache.set(key, p);
    if (S.cache.size > 40) { const first = S.cache.keys().next().value; if (first !== key) S.cache.delete(first); }
    return p;
  }

  function prefetch(idx) { for (let k = 1; k <= 3; k++) if (idx + k < S.sentences.length) request(idx + k).catch(() => {}); }

  // ---------- playback ----------
  function stopSource() {
    if (S.source) { S.source.onended = null; try { S.source.stop(); } catch (e) {} S.source = null; }
  }

  async function playSentence(idx) {
    if (idx < 0) idx = 0;
    if (idx >= S.sentences.length) { finish(); return; }
    S.cur = idx; setAttr("sentence", idx);
    stopSource();
    highlightSentence(idx);
    const myEpoch = S.epoch;
    let res = null;
    if (!S.modelReady) { S.loading = true; setPlayIcon(); setStatus("Loading voice…"); }
    else { const t = setTimeout(() => { if (S.cur === idx && S.playing && myEpoch === S.epoch && !S.source) { setStatus("Buffering…"); S.metrics.stalls = (S.metrics.stalls || 0) + 1; setAttr("stalls", S.metrics.stalls); } }, 150); }
    try {
      res = await request(idx);
      while (!res && myEpoch === S.epoch) res = await request(idx); // stale (queue jumped); ask again
    } catch (e) {
      console.warn("[ListenLater]", e); S.loading = false; S.playing = false; setPlayIcon(); setStatus(("Voice error: " + (e.message || e)).slice(0, 60)); return;
    }
    if (myEpoch !== S.epoch || !S.playing || !res) return;
    S.modelReady = true; S.loading = false; setPlayIcon();
    prefetch(idx);
    const src = S.ctx.createBufferSource();
    src.buffer = res.buffer; src.connect(S.ctx.destination);
    S.times = res.times; S.activeWord = -1;
    src.onended = () => { if (S.source === src && S.playing) playSentence(idx + 1); };
    S.source = src; S.startAt = S.ctx.currentTime + 0.02; src.start(S.startAt);
    if (S.metrics.firstAudioMs === null) { S.metrics.firstAudioMs = Math.round(performance.now() - S.metrics.playClickedAt); setAttr("first-audio-ms", S.metrics.firstAudioMs); }
    setStatus(`${idx + 1} / ${S.sentences.length}`);
    loop();
  }

  function loop() {
    cancelAnimationFrame(S.raf);
    const tick = () => {
      if (!S.playing || !S.times) return;
      const t = S.ctx.currentTime - S.startAt;
      let w = -1;
      for (let i = 0; i < S.times.length; i++) if (S.times[i][0] <= t + 0.03) w = i; else break;
      if (w !== S.activeWord && w >= 0) highlightWord(S.sentences[S.cur][w]);
      S.raf = requestAnimationFrame(tick);
    };
    S.raf = requestAnimationFrame(tick);
  }

  let sentSpans = [], wordSpans = [];
  function highlightSentence(idx) {
    sentSpans.forEach((s) => s.classList.remove("ll-sent"));
    sentSpans = S.sentences[idx].flatMap((u) => S.units[u].spans);
    sentSpans.forEach((s) => s.classList.add("ll-sent"));
    S.activeSent = idx;
    maybeScroll(sentSpans[0]);
  }
  function highlightWord(u) {
    wordSpans.forEach((s) => s.classList.remove("ll-word"));
    wordSpans = S.units[u].spans; wordSpans.forEach((s) => s.classList.add("ll-word"));
    S.activeWord = S.sentences[S.cur].indexOf(u); setAttr("word", u);
    maybeScroll(wordSpans[0]);
  }
  function clearHighlight() { sentSpans.forEach((s) => s.classList.remove("ll-sent")); wordSpans.forEach((s) => s.classList.remove("ll-word")); sentSpans = []; wordSpans = []; }

  let programmaticScrollUntil = 0;
  function maybeScroll(el) {
    if (!S.follow || !el) return;
    const r = el.getBoundingClientRect(), h = window.innerHeight;
    if (r.top < h * 0.15 || r.bottom > h * 0.75) {
      programmaticScrollUntil = performance.now() + 900;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  const userScrolled = () => {
    if (!S.playing || performance.now() < programmaticScrollUntil) return;
    if (S.follow) { S.follow = false; ui.follow.classList.add("show"); setAttr("follow", false); }
  };
  window.addEventListener("wheel", userScrolled, { passive: true });
  window.addEventListener("touchmove", userScrolled, { passive: true });
  window.addEventListener("keydown", (e) => { if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "].includes(e.key) && !e.target.closest?.("input,textarea,[contenteditable]")) userScrolled(); }, true);
  ui.follow.onclick = () => { S.follow = true; ui.follow.classList.remove("show"); setAttr("follow", true); if (wordSpans[0] || sentSpans[0]) (wordSpans[0] || sentSpans[0]).scrollIntoView({ block: "center", behavior: "smooth" }); };

  function finish() { S.playing = false; stopSource(); setPlayIcon(); setStatus("Done"); clearHighlight(); S.cur = 0; }

  async function play() {
    if (!prepare()) return;
    if (!S.ctx) { try { S.ctx = new AudioContext({ sampleRate: 24000, latencyHint: "playback" }); } catch (e) { S.ctx = new AudioContext(); } setAttr("ctx-rate", S.ctx.sampleRate); }
    if (S.ctx.state === "suspended") await S.ctx.resume();
    if (!S.metrics.playClickedAt) S.metrics.playClickedAt = performance.now();
    S.playing = true; setPlayIcon();
    if (S.source && S.times) { loop(); return; } // resume after pause
    playSentence(S.cur);
  }
  async function pause() { S.playing = false; setPlayIcon(); if (S.ctx) await S.ctx.suspend(); cancelAnimationFrame(S.raf); }
  function jump(idx) {
    if (!S.prepared) return;
    idx = Math.max(0, Math.min(S.sentences.length - 1, idx));
    S.epoch++; stopSource(); S.times = null;
    send({ type: "epoch", epoch: S.epoch }).catch(() => {});
    S.follow = true; ui.follow.classList.remove("show");
    if (S.playing) { if (S.ctx.state === "suspended") S.ctx.resume(); playSentence(idx); }
    else { S.cur = idx; setAttr("sentence", idx); highlightSentence(idx); setStatus(`${idx + 1} / ${S.sentences.length}`); }
  }
  function regenerate() { S.cache.clear(); jump(S.cur); }

  ui.play.onclick = () => (S.playing ? pause() : play());
  ui.next.onclick = () => jump(S.cur + 1);
  ui.prev.onclick = () => {
    // like a music player: restart sentence if >1.5s in, else go back one
    const t = S.ctx && S.times ? S.ctx.currentTime - S.startAt : 0;
    jump(t > 1.5 ? S.cur : S.cur - 1);
  };
  ui.speed.onchange = () => { S.speed = +ui.speed.value; chrome.storage.local.set({ speed: S.speed }); if (S.prepared) regenerate(); };
  ui.quality.onchange = () => { S.quality = ui.quality.value; chrome.storage.local.set({ quality: S.quality }); S.modelReady = false; if (S.prepared) regenerate(); };
  ui.voice.onchange = () => { S.voice = ui.voice.value; chrome.storage.local.set({ voice: S.voice }); if (S.prepared) regenerate(); };
  let userHid = false;
  ui.close.onclick = () => { pause(); userHid = true; host.style.display = "none"; };

  // click any word (outside links) to jump to its sentence
  document.addEventListener("click", (e) => {
    if (!S.prepared || host.style.display === "none") return;
    const w = e.target.closest?.(".ll-w");
    if (!w || w.closest("a")) return;
    const sel = window.getSelection(); if (sel && !sel.isCollapsed) return;
    const u = S.units[+w.dataset.llw]; if (!u) return;
    if (!S.playing) { jump(u.sentence); play(); } else jump(u.sentence);
  });
  window.addEventListener("keydown", (e) => { if (e.altKey && e.shiftKey && e.code === "KeyP" && host.style.display !== "none") { e.preventDefault(); S.playing ? pause() : play(); } });

  function showPlayer() {
    userHid = false;
    if (!S.article) { try { S.article = detectArticle(); } catch (e) {} }
    const wasHidden = host.style.display === "none";
    host.style.display = "block";
    if (wasHidden && !S.playing && !S.loading && !S.saving) {
      if (S.article) setStatus(`Listen · ${Math.max(1, Math.round((S.article.chars || 0) / 900))} min`);
      else setStatus("Listen");
    }
    refreshAlways();
  }
  async function refreshAlways() {
    try {
      const r = await chrome.runtime.sendMessage({ type: "get-always-on", url: location.href });
      const on = !!r?.enabled;
      ui.always.textContent = on ? "Stop always showing on this site" : "Always show on this site";
      ui.always.title = on
        ? "The player shows by itself on this site. Click to turn that off."
        : "Show the player automatically whenever you visit this site.";
      setAttr("always-on", on);
    } catch (e) {}
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "ping") { sendResponse({ ok: true }); return false; }
    if (msg?.type === "show-player") { showPlayer(); sendResponse({ ok: true }); return false; }
    if (msg?.type === "toggle-player") {
      if (host.style.display === "none") showPlayer(); else { pause(); userHid = true; host.style.display = "none"; }
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === "always-on-changed") {
      refreshAlways().then(() => {
        if (host.style.display === "none") return;
        toast(host.dataset.alwaysOn === "true" ? "The player will show by itself on this site." : "This site is back to click to listen.", "ok", 5000);
      });
      return false;
    }
    if (msg?.type === "progress") {
      if (msg.stage === "download" && !S.modelReady) setStatus(`Downloading voice ${msg.pct}%`);
      if (msg.stage === "ready") setAttr("engine", `${msg.device}/${msg.dtype}`);
      if (msg.stage === "ready" && !S.saving) setStatus("Voice ready");
    }
    return false;
  });

  // ---------- send to phone (user's own Listen Later server) ----------
  // __SERVER_NAME__ is set by the build: "your Listen Later server" unless a personal build's local.config.json
  // names it (e.g. "your home server"). With no server configured, the user is asked to set one in Options first.
  const SERVER_NAME = __SERVER_NAME__;
  // Builds {title, source_url, chapters:[{title,text}]} from the detected article, split at its section headings,
  // and POSTs it (via the service worker) to the user's own server's /api/ingest.
  function cleanText(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll("sup, script, style, noscript, button, svg, [aria-hidden='true']").forEach((n) => n.remove());
    return norm(c.textContent);
  }
  function buildChapters(art) {
    const isH = (el) => /^H[1-6]$/.test(el.tagName);
    const title = norm(art.title) || document.title;
    const blocks = art.blocks.filter((b) => !(b.tagName === "H1" && norm(b.textContent) && title.startsWith(norm(b.textContent))));
    const levels = blocks.filter(isH).map((h) => +h.tagName[1]).filter((l) => l >= 2);
    const splitLevel = levels.length ? Math.min(...levels) : 0;
    const chapters = []; let cur = { title: "Introduction", parts: [] };
    for (const b of blocks) {
      const t = cleanText(b); if (!t) continue;
      if (splitLevel && isH(b) && +b.tagName[1] === splitLevel) {
        if (cur.parts.length) chapters.push(cur);
        cur = { title: t.slice(0, 120), parts: [/[.!?:]$/.test(t) ? t : t + "."] };
      } else cur.parts.push(b.tagName === "LI" ? "• " + t : t);
    }
    if (cur.parts.length) chapters.push(cur);
    // merge tiny sections into the next one
    const out = [];
    for (const ch of chapters) {
      const text = ch.parts.join("\n\n");
      if (out.length && out[out.length - 1].text.length < 200) { out[out.length - 1].text += "\n\n" + text; continue; }
      out.push({ title: ch.title, text });
    }
    if (out.length === 1 && out[0].title === "Introduction") out[0].title = title;
    return { title, source_url: location.href.split("#")[0], chapters: out };
  }
  async function sendToPhone() {
    const art = detectArticle() || S.article;
    if (!art) { toast("No article found on this page.", "err"); return; }
    const payload = buildChapters(art);
    const words = payload.chapters.reduce((a, c) => a + c.text.split(/\s+/).length, 0);
    ui.phone.disabled = true; toast(`Sending <b>${esc(payload.title)}</b> to ${SERVER_NAME}…`, "ok", 20000);
    try {
      const r = await chrome.runtime.sendMessage({ type: "send-to-phone", payload });
      if (r?.needsServer || r?.needsPermission) {
        toast(r.needsServer
          ? `<b>Set up Send to my phone</b><br><span style="color:#aaa">Enter the address of your own Listen Later server in Options. Nothing is sent until you do.</span><br><button class="opts" style="all:unset;cursor:pointer;margin-top:8px;display:inline-block;background:#ffbe00;color:#111;font-weight:600;border-radius:999px;padding:6px 12px">Open settings</button>`
          : `<b>Allow access to ${esc(r.server)}</b><br><span style="color:#aaa">Open Options and press Save to let Listen Later reach your server.</span><br><button class="opts" style="all:unset;cursor:pointer;margin-top:8px;display:inline-block;background:#ffbe00;color:#111;font-weight:600;border-radius:999px;padding:6px 12px">Open settings</button>`,
          "err", 15000);
        setAttr("needs-server", r.needsServer ? "server" : "permission");
        const b = ui.toast.querySelector(".opts"); if (b) b.onclick = () => chrome.runtime.sendMessage({ type: "open-options" });
      }
      else if (r?.ok) toast(`Sent to ${SERVER_NAME}: <b>${esc(payload.title)}</b> (${payload.chapters.length} chapters, ${words.toLocaleString()} words). It'll be in your podcast feed in a few minutes.`, "ok", 8000);
      else toast(`Couldn't send: ${esc(r?.error || "unknown error")}.<br><span style="color:#aaa">Server: ${esc(r?.server || "?")}. Check you're on the same network, or change it in the extension's Options.</span>`, "err", 12000);
    } catch (e) { toast("Couldn't send: " + esc(e.message || e), "err", 10000); }
    finally { ui.phone.disabled = false; }
  }
  ui.phone.onclick = sendToPhone;

  // ---------- save episode (one HTML file on this computer; no upload) ----------
  // Replaces the old "share listen link", which only copied the article URL plus #listen-later.
  // Audio is the same on-device Kokoro PCM the player uses, packed as 16-bit WAV inside the file.
  function downloadHtml(filename, html) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  function setSaveLocked(locked) {
    S.saving = locked;
    ui.save.disabled = locked;
    if (ui.hosted) ui.hosted.disabled = locked;
    ui.play.disabled = locked;
    ui.prev.disabled = locked;
    ui.next.disabled = locked;
  }
  async function saveEpisode() {
    if (S.saving) return;
    if (S.playing) await pause();
    if (!prepare() || !S.sentences?.length) { toast("No article found on this page.", "err"); return; }
    setSaveLocked(true);
    S.epoch++;
    const epoch = S.epoch;
    send({ type: "epoch", epoch }).catch(() => {});
    toast("Creating the audio on this computer. A long article can take a few minutes.", "ok", 20000);
    try {
      const chunks = [];
      const blocks = [];
      let cur = [];
      const starts = new Set(S.blockStarts || [0]);
      let samples = 0;
      let sampleRate = 24000;
      for (let s = 0; s < S.sentences.length; s++) {
        if (epoch !== S.epoch) { toast("Save cancelled.", "err"); return; }
        setStatus(`Saving ${s + 1}/${S.sentences.length}`);
        setAttr("save", `${s + 1}/${S.sentences.length}`);
        const words = S.sentences[s].map((u) => S.units[u].text);
        const r = await send({ type: "synth", words, voice: S.voice, speed: S.speed, quality: S.quality, epoch });
        if (epoch !== S.epoch) { toast("Save cancelled.", "err"); return; }
        if (!r?.ok) throw new Error(r?.error || "voice failed");
        const audio = float32FromBase64(r.f32);
        if (chunks.length && r.sampleRate !== sampleRate) throw new Error("sample rate changed");
        sampleRate = r.sampleRate;
        const t0 = samples / sampleRate;
        S.sentences[s].forEach((ui, i) => {
          if (starts.has(ui) && cur.length) { blocks.push(cur); cur = []; }
          const span = r.times[i] || [0, 0];
          cur.push({ text: S.units[ui].text, start: span[0] + t0, end: span[1] + t0 });
        });
        chunks.push(audio);
        samples += audio.length;
        S.modelReady = true;
      }
      if (cur.length) blocks.push(cur);
      const wav = encodeWav(concatFloat32(chunks), sampleRate);
      const title = norm(S.article?.title) || document.title || "Article";
      const filename = episodeFilename(title);
      const voiceLabel = VOICES.find(([id]) => id === S.voice)?.[1] || S.voice;
      const html = buildEpisodeHtml({
        title,
        sourceUrl: location.href.split("#")[0],
        blocks,
        wavBase64: bytesToBase64(wav),
        voiceLabel,
        durationSec: samples / sampleRate,
      });
      downloadHtml(filename, html);
      const mb = wav.byteLength / 1e6;
      const size = mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
      setAttr("saved", filename);
      setAttr("save-bytes", wav.byteLength);
      setStatus("Saved");
      toast(`Saved <b>${esc(filename)}</b> (${size}). Open the HTML file anytime, even offline. The audio is inside it. To keep it on your other devices, move it into a Google Drive or Dropbox folder.`, "ok", 12000);
    } catch (e) {
      console.warn("[ListenLater] save failed", e);
      toast("Couldn't save: " + esc(e.message || e), "err", 10000);
      setStatus("Save failed");
    } finally {
      setSaveLocked(false);
    }
  }
  ui.save.onclick = () => { saveEpisode(); };
  attachHostedSave({
    shadow,
    ui,
    getState: () => S,
    send,
    toast,
    prepare,
    pause,
    esc,
    setStatus,
    setAttr,
    setSaveLocked,
    voices: VOICES,
    title: () => norm(S.article?.title) || document.title || "Article",
    sourceUrl: () => location.href.split("#")[0],
    blockElements: () => S.article?.blocks || [],
  });
  ui.always.onclick = async () => {
    if (host.dataset.alwaysOn === "true") {
      await chrome.runtime.sendMessage({ type: "set-always-on", url: location.href, enabled: false });
      return;
    }
    const r = await chrome.runtime.sendMessage({ type: "prompt-always-on", url: location.href });
    if (!r?.ok) toast("Couldn't ask Chrome to allow this site: " + esc(r?.error || "unknown error"), "err", 8000);
    else toast("Confirm this site in the tab Chrome just opened.", "ok", 8000);
  };

  // ---------- boot ----------
  chrome.storage.local.get(["voice", "speed", "quality"]).then((v) => {
    if (v.quality) { S.quality = v.quality; ui.quality.value = v.quality; }
    if (v.voice) { S.voice = v.voice; ui.voice.value = v.voice; }
    if (v.speed) { S.speed = v.speed; ui.speed.value = String(v.speed); }
  });
  document.documentElement.appendChild(host);
  setPlayIcon();
  const boot = () => {
    try {
      if (!isProbablyReaderable(document, { minContentLength: 140, minScore: 20 })) return false;
      const art = detectArticle();
      if (!art || art.blocks.length < 3) return false;
      S.article = art;
      if (userHid) return true;
      host.style.display = "block";
      if (!S.playing && !S.saving) setStatus(`Listen · ${Math.max(1, Math.round(art.chars / 900))} min`);
      setAttr("detected", art.blocks.length);
      refreshAlways();
      return true;
    } catch (e) { console.warn("[ListenLater] detect failed", e); return false; }
  };
  // SPA/hydrated pages may render late: try a few times. The player stays hidden until this
  // script is injected, which only happens after the user turns the page on.
  let tries = 0; const iv = setInterval(() => {
    if (boot()) return clearInterval(iv);
    if (++tries > 5) {
      clearInterval(iv);
      if (!S.article && host.style.display !== "none") setStatus("No article found");
    }
  }, 1200);
  if (boot()) clearInterval(iv);
})();
