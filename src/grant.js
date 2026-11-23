// SPDX-License-Identifier: GPL-3.0-or-later
// Confirmation tab for "Always show on this site". permissions.request has to run in an
// extension page during a click. A content-script click does not count.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const origin = params.get("origin") || "";
$("origin").textContent = origin || "(missing site)";
const msg = (t, ok = false) => { $("msg").textContent = t; $("msg").style.color = ok ? "#1a7f37" : "#c0392b"; };

async function closeTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) await chrome.tabs.remove(tab.id);
  else window.close();
}

$("cancel").onclick = () => { closeTab(); };
$("allow").onclick = async () => {
  if (!/^https?:\/\/[^/]+$/.test(origin)) return msg("That site address is not valid.");
  const pattern = origin + "/*";
  try {
    let granted = await chrome.permissions.contains({ origins: [pattern] });
    if (!granted) granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) return msg("Chrome did not allow that site. Listen Later will only run there when you turn it on.");
    const r = await chrome.runtime.sendMessage({ type: "set-always-on", origin, enabled: true });
    if (!r?.ok) return msg(r?.error || "Could not turn that on.");
    await closeTab();
  } catch (e) {
    msg(e.message || String(e));
  }
};
