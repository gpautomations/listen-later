// Ask the extension to inject the player into the page's tab.
// The service worker does not receive its own runtime.sendMessage, so this is sent from
// the options page. Injection still needs host access for that origin (activeTab is only
// granted for a real toolbar click). Test builds pass EXTRA_HOST_PERMISSIONS. The store build does not.
async function sendActivate(sw, page) {
  const url = page.url();
  const extId = new URL(sw.url()).host;
  const opener = await page.context().newPage();
  await opener.goto(`chrome-extension://${extId}/options.html`);
  const res = await opener.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === url);
    if (!tab?.id) return { ok: false, error: "tab not found for " + url };
    return chrome.runtime.sendMessage({ type: "activate-tab", tabId: tab.id });
  }, url);
  await opener.close();
  return res;
}

export async function requestActivate(sw, page) {
  return sendActivate(sw, page);
}

export async function activateTab(sw, page) {
  const res = await sendActivate(sw, page);
  if (!res?.ok) {
    throw new Error("Listen Later did not turn on (" + (res?.error || "no response") + ") " + JSON.stringify(res) + ". Rebuild with EXTRA_HOST_PERMISSIONS for this origin, or click the toolbar in a real browser.");
  }
  return res;
}
