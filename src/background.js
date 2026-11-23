// Listen Later service worker: owns the offscreen document (model lives there), relays progress to tabs,
// performs "Send to my phone" POSTs to the user's own Listen Later server (host permission => no CORS needed),
// and injects the player only after the user turns a page on.
const DEFAULT_SERVER = ""; // no default server; build.mjs can inject one from an uncommitted local.config.json (personal builds only)
let creating = null;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run the Kokoro text-to-speech model locally (WebGPU/WASM) for read-along audio.",
    }).finally(() => { creating = null; });
  }
  await creating;
}

async function getServer() {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  return (serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
}
const originPattern = (url) => { const u = new URL(url); return `${u.protocol}//${u.hostname}/*`; };

// Match patterns cannot name a port, so a pinned site is the scheme plus hostname.
function siteOrigin(input) {
  const u = new URL(input);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("use an http or https address");
  let host = u.hostname;
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `${u.protocol}//${host}`;
}
function siteScriptId(origin) {
  let h = 0;
  for (let i = 0; i < origin.length; i++) h = (h * 33 + origin.charCodeAt(i)) >>> 0;
  const u = new URL(origin);
  const proto = u.protocol === "https:" ? "s" : "h";
  const host = u.hostname.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40);
  return `ll_${proto}_${host}_${h.toString(36)}`;
}

async function registerSite(origin) {
  const id = siteScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [`${origin}/*`],
    js: ["content.js"],
    css: ["content.css"],
    runAt: "document_idle",
    persistAcrossSessions: true,
  }]);
}

async function notifySite(origin) {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "always-on-changed" }).catch(() => {});
}

async function ensurePlayer(tabId, mode) {
  let alive = false;
  try { alive = !!(await chrome.tabs.sendMessage(tabId, { type: "ping" }))?.ok; } catch (e) { alive = false; }
  if (!alive) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
  const type = mode === "toggle" && alive ? "toggle-player" : "show-player";
  await chrome.tabs.sendMessage(tabId, { type });
  return { ok: true, toggled: mode === "toggle" && alive };
}

function canInject(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (e) { return false; }
}

async function activate(tab) {
  if (!tab?.id) return { ok: false, error: "no tab" };
  if (!canInject(tab.url)) {
    try {
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
      await chrome.action.setTitle({ tabId: tab.id, title: "Listen Later can't run on this page. Open an http or https article and try again." });
    } catch (e) {}
    return { ok: false, error: "page not supported" };
  }
  try { await chrome.action.setBadgeText({ tabId: tab.id, text: "" }); } catch (e) {}
  try {
    return await ensurePlayer(tab.id, "toggle");
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function setAlwaysOn(origin, enabled) {
  const pattern = `${origin}/*`;
  const { alwaysOnSites = [] } = await chrome.storage.local.get("alwaysOnSites");
  const id = siteScriptId(origin);
  if (!enabled) {
    const next = alwaysOnSites.filter((o) => o !== origin);
    await chrome.storage.local.set({ alwaysOnSites: next });
    await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
    const server = await getServer();
    let serverOrigin = "";
    try { if (server) serverOrigin = siteOrigin(server); } catch (e) {}
    if (serverOrigin !== origin) {
      try { await chrome.permissions.remove({ origins: [pattern] }); } catch (e) {}
    }
    await notifySite(origin);
    return { ok: true, enabled: false, origin };
  }
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
    let granted = false;
    try { granted = await chrome.permissions.request({ origins: [pattern] }); } catch (e) { granted = false; }
    if (!granted) return { ok: false, needsPermission: true, origin };
  }
  const next = [...new Set([...alwaysOnSites, origin])];
  await chrome.storage.local.set({ alwaysOnSites: next });
  try {
    await registerSite(origin);
  } catch (e) {
    await chrome.storage.local.set({ alwaysOnSites });
    return { ok: false, error: "Couldn't watch that site (" + (e?.message || e) + ")." };
  }
  const tabs = await chrome.tabs.query({ url: pattern });
  for (const tab of tabs) {
    try { await ensurePlayer(tab.id, "show"); } catch (e) {}
  }
  await notifySite(origin);
  return { ok: true, enabled: true, origin };
}

async function syncAlwaysOn() {
  const { alwaysOnSites = [] } = await chrome.storage.local.get("alwaysOnSites");
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const wanted = new Set();
  for (const origin of alwaysOnSites) {
    if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) continue;
    wanted.add(siteScriptId(origin));
    try { await registerSite(origin); } catch (e) { console.warn("[ListenLater] register failed", origin, e); }
  }
  const stale = registered.map((s) => s.id).filter((id) => id.startsWith("ll_") && !wanted.has(id));
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale }).catch(() => {});
}

async function sendToPhone(payload) {
  const server = await getServer();
  if (!server) return { ok: false, needsServer: true };
  // Host access to the user's server is optional and granted from the Options page (user gesture).
  if (!(await chrome.permissions.contains({ origins: [originPattern(server)] }))) return { ok: false, needsPermission: true, server };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(server + "/api/ingest", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal,
    });
    let body = null; try { body = await res.json(); } catch (e) {}
    if (!res.ok) return { ok: false, server, status: res.status, error: (body && body.error) || `server answered ${res.status}` };
    return { ok: true, server, status: res.status, result: body };
  } catch (e) {
    const msg = e.name === "AbortError" ? "timed out" : "couldn't reach the server";
    return { ok: false, server, error: msg };
  } finally { clearTimeout(timer); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "ensure-engine") {
    ensureOffscreen().then(() => sendResponse({ ok: true, tabId: sender.tab?.id })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "send-to-phone") {
    sendToPhone(msg.payload).then(sendResponse);
    return true;
  }
  if (msg?.type === "open-options") { chrome.runtime.openOptionsPage(); return false; }
  if (msg?.type === "relay" && msg.tabId != null) {
    chrome.tabs.sendMessage(msg.tabId, msg.payload).catch(() => {});
    return false;
  }
  if (msg?.type === "get-always-on") {
    (async () => {
      try {
        const origin = siteOrigin(msg.url || msg.origin);
        const { alwaysOnSites = [] } = await chrome.storage.local.get("alwaysOnSites");
        sendResponse({ ok: true, origin, enabled: alwaysOnSites.includes(origin) });
      } catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
    })();
    return true;
  }
  if (msg?.type === "set-always-on") {
    (async () => {
      try { sendResponse(await setAlwaysOn(siteOrigin(msg.url || msg.origin), !!msg.enabled)); }
      catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
    })();
    return true;
  }
  if (msg?.type === "prompt-always-on") {
    (async () => {
      try {
        const origin = siteOrigin(msg.url || msg.origin);
        const url = chrome.runtime.getURL("grant.html") + "?origin=" + encodeURIComponent(origin);
        await chrome.tabs.create({ url, openerTabId: sender.tab?.id });
        sendResponse({ ok: true, origin });
      } catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
    })();
    return true;
  }
  if (msg?.type === "activate-tab") {
    (async () => {
      try {
        const extensionPage = typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
        let tab = null;
        if ((extensionPage || !sender.tab) && msg.tabId) tab = await chrome.tabs.get(msg.tabId);
        else if (sender.tab && (!msg.tabId || msg.tabId === sender.tab.id)) tab = sender.tab;
        else return sendResponse({ ok: false, error: "not allowed" });
        sendResponse(await activate(tab));
      } catch (e) { sendResponse({ ok: false, error: String(e?.message || e) }); }
    })();
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener((tab) => { activate(tab); });
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "listen-page") return;
  if (tab?.id) activate(tab);
  else chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { if (tabs[0]) activate(tabs[0]); });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "listen-page") activate(tab);
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "listen-page", title: "Listen to this page", contexts: ["page", "action"] });
  });
  chrome.action.setBadgeBackgroundColor({ color: "#c0392b" }).catch(() => {});
  syncAlwaysOn().catch((e) => console.warn("[ListenLater] site sync failed", e));
});
chrome.runtime.onStartup.addListener(() => { syncAlwaysOn().catch(() => {}); });
syncAlwaysOn().catch((e) => console.warn("[ListenLater] site sync failed", e));
