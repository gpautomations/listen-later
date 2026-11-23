// SPDX-License-Identifier: GPL-3.0-or-later
// Options section for the hosted private link. Injected beside the existing page so the
// phone-server options can keep changing in their own file.
import { checkHealth, configuredBase, deleteEpisode, ensureHostedPermission, hostPermissionPattern, listEpisodes, normalizeBaseUrl } from "./lib/hosted/api.mjs";

const $ = (id) => document.getElementById(id);

function say(text, ok = true) {
  const el = $("hosted-msg");
  el.textContent = text;
  el.style.color = ok ? "#1a7f37" : "#c0392b";
}

async function unusedPermission(url) {
  const pattern = hostPermissionPattern(url);
  const { serverUrl, alwaysOnSites = [] } = await chrome.storage.local.get(["serverUrl", "alwaysOnSites"]);
  if (serverUrl) {
    try { if (hostPermissionPattern(serverUrl) === pattern) return; } catch (e) { /* different shape */ }
  }
  for (const origin of alwaysOnSites) {
    try { if (hostPermissionPattern(origin) === pattern) return; } catch (e) { /* skip */ }
  }
  try { await chrome.permissions.remove({ origins: [pattern] }); } catch (e) { /* already gone */ }
}

function section() {
  const about = document.querySelector(".about");
  const el = document.createElement("section");
  el.id = "hosted-section";
  el.innerHTML = `
    <h2>Save and get link</h2>
    <p class="note">Optional. Set the address of a Listen Later hosted service and the player shows a link button next to Save episode. It uploads the read-along and gives you a private link you can open on a phone. Chrome asks before it allows that address. Leave this blank and nothing is uploaded.</p>
    <p class="note">The link is private because the address is a long random id. Anyone you send it to can open it. There is no public list of episodes. This browser keeps a key that lists and deletes yours. Removing the extension deletes that key. Delete episodes you do not want before you uninstall. Email sign-in is not built yet, so there is no way to recover the key.</p>
    <label for="hosted-base">Hosted address</label>
    <input id="hosted-base" type="url" placeholder="https://listen-later-hosted-staging.example.workers.dev">
    <div>
      <button id="hosted-save" type="button">Save</button>
      <button id="hosted-test" class="secondary" type="button">Test connection</button>
      <button id="hosted-clear" class="secondary" type="button">Remove address</button>
    </div>
    <h2>My saved episodes</h2>
    <p class="note">These are the episodes this browser uploaded to the address above.</p>
    <button id="hosted-refresh" class="secondary" type="button">Refresh</button>
    <ul id="hosted-list"></ul>
    <div id="hosted-msg"></div>
  `;
  about.before(el);
}

function note(ul, text) {
  const li = document.createElement("li");
  li.className = "note";
  li.textContent = text;
  ul.appendChild(li);
}

async function addressAllowed(base) {
  try {
    return await chrome.permissions.contains({ origins: [hostPermissionPattern(base)] });
  } catch (e) {
    return false;
  }
}

async function renderList() {
  const ul = $("hosted-list");
  ul.replaceChildren();
  let base = "";
  try { base = await configuredBase(); } catch (e) { base = ""; }
  if (!base) {
    note(ul, "No hosted address yet.");
    return;
  }
  if (!(await addressAllowed(base))) {
    note(ul, "Press Save so Chrome can allow this address. Then the list can load.");
    return;
  }
  let body;
  try { body = await listEpisodes(); } catch (e) {
    const raw = String(e?.message || "");
    note(ul, /fetch|network/i.test(raw)
      ? "Could not reach the hosted service. Check the address, and press Save so Chrome can allow it."
      : (raw || "Could not load episodes."));
    return;
  }
  const episodes = body.episodes || [];
  if (!episodes.length) {
    const li = document.createElement("li");
    li.className = "note";
    li.textContent = "No saved episodes on this address yet.";
    ul.appendChild(li);
    return;
  }
  for (const episode of episodes) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = episode.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = episode.title || "Untitled";
    li.append(link, document.createTextNode(" "));
    const del = document.createElement("button");
    del.className = "secondary inline";
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      if (!confirm("Delete this private link? The page will stop opening.")) return;
      try {
        await deleteEpisode(episode.id);
        say("Deleted.");
        renderList();
      } catch (e) { say(e.message || "Could not delete it.", false); }
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
}

async function boot() {
  section();
  let base = "";
  try { base = await configuredBase(); } catch (e) { base = ""; }
  $("hosted-base").value = base;
  $("hosted-save").addEventListener("click", async () => {
    const raw = $("hosted-base").value.trim();
    if (!raw) return say("Enter the hosted address first.", false);
    let url;
    try { url = normalizeBaseUrl(raw); } catch (e) { return say("That address needs to be https.", false); }
    const granted = await ensureHostedPermission(url).catch(() => false);
    await chrome.storage.local.set({ hostedBaseUrl: url, hostedBaseCleared: false });
    $("hosted-base").value = url;
    say(granted ? "Saved. The link button will show on articles." : "Saved, but Chrome did not allow that address yet.", !!granted);
    renderList();
  });
  $("hosted-clear").addEventListener("click", async () => {
    const { hostedBaseUrl = "" } = await chrome.storage.local.get("hostedBaseUrl");
    const current = hostedBaseUrl || $("hosted-base").value.trim();
    await chrome.storage.local.set({ hostedBaseCleared: true });
    await chrome.storage.local.remove("hostedBaseUrl");
    if (current) {
      try { await unusedPermission(normalizeBaseUrl(current)); } catch (e) { /* nothing to remove */ }
    }
    $("hosted-base").value = "";
    say("Hosted address removed. Save and get link is hidden. Episodes already uploaded stay up until you delete them.");
    renderList();
  });
  $("hosted-test").addEventListener("click", async () => {
    let url;
    try { url = normalizeBaseUrl($("hosted-base").value.trim()); } catch (e) { return say("Enter an https address first.", false); }
    const granted = await ensureHostedPermission(url).catch(() => false);
    if (!granted) return say("Chrome did not allow that address.", false);
    try {
      await checkHealth(url);
      say("Connected. The link service answered.");
    } catch (e) { say("Couldn't reach it (" + (e.message || e) + ").", false); }
  });
  $("hosted-refresh").addEventListener("click", () => { renderList(); });
  renderList();
}

boot();
