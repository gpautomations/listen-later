// SPDX-License-Identifier: GPL-3.0-or-later
// Options: no default server. The user enters their own Listen Later server; host access to it is an
// optional permission requested at runtime (on Save / Test, which are user gestures).
// build.mjs can inject a default from an uncommitted local.config.json (personal builds only).
const DEFAULT_SERVER = "";
const $ = (id) => document.getElementById(id);
const msg = (t, ok = true) => { $("msg").textContent = t; $("msg").style.color = ok ? "#1a7f37" : "#c0392b"; };
$("version").textContent = chrome.runtime.getManifest().version;
chrome.storage.local.get(["serverUrl", "quality"]).then((v) => {
  $("server").value = v.serverUrl || DEFAULT_SERVER;
  $("quality").value = v.quality || "high";
});
async function renderSites() {
  const { alwaysOnSites = [] } = await chrome.storage.local.get("alwaysOnSites");
  const ul = $("sites");
  ul.replaceChildren();
  if (!alwaysOnSites.length) {
    const li = document.createElement("li");
    li.className = "note";
    li.textContent = "No sites yet. Listen Later stays off until you turn it on.";
    ul.appendChild(li);
    return;
  }
  for (const origin of alwaysOnSites) {
    const li = document.createElement("li");
    li.append(document.createTextNode(origin));
    const b = document.createElement("button");
    b.className = "secondary inline";
    b.textContent = "Remove";
    b.onclick = async () => {
      const r = await chrome.runtime.sendMessage({ type: "set-always-on", origin, enabled: false });
      msg(r?.ok ? "Removed " + origin + "." : (r?.error || "Could not remove that site."), !!r?.ok);
      renderSites();
    };
    li.appendChild(b);
    ul.appendChild(li);
  }
}
renderSites();
window.addEventListener("focus", renderSites);
$("add-site").onclick = async () => {
  const raw = $("site").value.trim();
  if (!raw) return msg("Enter a site address, for example https://en.wikipedia.org.", false);
  let origin;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) throw new Error("use an http:// or https:// address");
    let host = u.hostname;
    if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
    origin = `${u.protocol}//${host}`;
  } catch (e) { return msg("That doesn't look like a site address (" + e.message + ").", false); }
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] }).catch(() => false);
  if (!granted) return msg("Chrome didn't allow " + origin + ".", false);
  const r = await chrome.runtime.sendMessage({ type: "set-always-on", origin, enabled: true });
  if (!r?.ok) return msg(r?.error || "Couldn't turn that on.", false);
  $("site").value = "";
  msg("Always showing on " + origin + ".");
  renderSites();
};
// Match patterns cover all ports on a host.
function originPattern(url) { const u = new URL(url); return `${u.protocol}//${u.hostname}/*`; }
function readUrl() {
  const url = $("server").value.trim().replace(/\/+$/, "");
  if (!url) return null;
  const u = new URL(url); // throws on garbage
  if (!/^https?:$/.test(u.protocol)) throw new Error("use an http:// or https:// address");
  return url;
}
async function ensurePermission(url) {
  const origins = [originPattern(url)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}
$("save").onclick = async () => {
  let url;
  try { url = readUrl(); } catch (e) { return msg("That doesn't look like a server address (" + e.message + ").", false); }
  if (!url) return msg("Enter your Listen Later server's address first, for example http://my-computer.local:7778.", false);
  const granted = await ensurePermission(url).catch(() => false);
  await chrome.storage.local.set({ serverUrl: url, quality: $("quality").value });
  msg(granted ? "Saved." : "Saved, but Chrome didn't grant access to that server, so sending will fail until you allow it.", granted);
};
$("clear").onclick = async () => {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  if (serverUrl) { try { await chrome.permissions.remove({ origins: [originPattern(serverUrl)] }); } catch (e) {} }
  await chrome.storage.local.remove("serverUrl"); $("server").value = "";
  msg("Server removed. Send to my phone is off until you add one.");
};
$("quality").onchange = () => chrome.storage.local.set({ quality: $("quality").value }).then(() => msg("Saved. Applies the next time you press play."));
$("test").onclick = async () => {
  let url;
  try { url = readUrl(); } catch (e) { return msg("That doesn't look like a server address.", false); }
  if (!url) return msg("Enter your server's address first.", false);
  try {
    if (!(await ensurePermission(url))) throw new Error("access not allowed");
    const r = await fetch(url + "/api/items");
    if (!r.ok) throw new Error("server answered " + r.status);
    const items = await r.json();
    msg(`Connected. Your library has ${items.length} item${items.length === 1 ? "" : "s"}.`);
  } catch (e) { msg("Couldn't reach " + url + " (" + (e.message || e) + "). Is your server running and on the same network?", false); }
};
