// SPDX-License-Identifier: GPL-3.0-or-later
// Google sign-in has to run from an extension page during a click. A content-script click does not count.
import { driveClientConfigured } from "./lib/drive-config.mjs";

const $ = (id) => document.getElementById(id);
const msg = (t, ok = false) => { $("msg").textContent = t; $("msg").style.color = ok ? "#1a7f37" : "#c0392b"; };

async function closeTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) await chrome.tabs.remove(tab.id);
  else window.close();
}

const clientId = chrome.runtime.getManifest().oauth2?.client_id || "";
if (!driveClientConfigured(clientId)) {
  $("connect").hidden = true;
  msg("Google Drive is not set up in this copy of Listen Later.");
}

$("cancel").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "drive-denied" });
  await closeTab();
};

$("connect").onclick = async () => {
  if (!driveClientConfigured(clientId)) return;
  try {
    const origins = ["https://www.googleapis.com/*"];
    const granted = await chrome.permissions.request({ permissions: ["identity"], origins });
    if (!granted) {
      msg("Chrome did not allow Google Drive.");
      return;
    }
    const result = await chrome.identity.getAuthToken({ interactive: true });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) return msg("Google sign-in was cancelled.");
    await chrome.runtime.sendMessage({ type: "drive-connected" });
    await closeTab();
  } catch (e) {
    msg(e.message || String(e));
  }
};
