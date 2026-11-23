// The store manifest must stay opt-in: no content script on every page, version still 0.2.0.
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
const problems = [];
const fail = (s) => problems.push(s);

if (m.version !== "0.2.0") fail("version was bumped (" + m.version + ")");
if (m.content_scripts) fail("content_scripts is set");
for (const key of ["activeTab", "scripting", "contextMenus", "offscreen", "storage"]) {
  if (!m.permissions.includes(key)) fail("missing permission " + key);
}
if (!m.permissions.includes("downloads")) fail("missing downloads permission for the save dialog fallback");
if (m.permissions.includes("identity")) fail("identity should stay optional until Google Drive is connected");
if (!m.optional_permissions?.includes("identity")) fail("optional identity permission missing");
if (!String(m.oauth2?.client_id || "").startsWith("REPLACE_ME.")) fail("oauth client id must stay unset");
if (JSON.stringify(m.oauth2?.scopes || []) !== JSON.stringify(["https://www.googleapis.com/auth/drive.file"])) fail("oauth scope must be drive.file only");
const hosts = JSON.stringify(m.host_permissions || []);
if (hosts.includes("<all_urls>") || hosts.includes("http://*/*") || hosts.includes("https://*/*")) fail("broad host_permissions: " + hosts);
if (!m.commands?.["listen-page"]?.description) fail("missing listen-page command");
if (m.commands["listen-page"].suggested_key?.default !== "Alt+Shift+L") fail("shortcut changed");
const optional = m.optional_host_permissions || [];
if (!optional.includes("https://*/*") || !optional.includes("http://*/*")) fail("optional host permissions should stay so one site or a server can be granted later");

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("manifest ok", m.version, m.permissions.join(", "));
