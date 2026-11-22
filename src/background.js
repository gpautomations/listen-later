// Listen Later service worker: owns the offscreen document (model lives there), relays progress to tabs,
// and performs "Send to my phone" POSTs to the user's own Listen Later server (host permission => no CORS needed).
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
  return false;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: "toggle-player" }).catch(() => {});
});
