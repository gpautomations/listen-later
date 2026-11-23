// SPDX-License-Identifier: GPL-3.0-or-later
// Save to Google Drive stays hidden until a real OAuth client id is pasted into the manifest.
// REPLACE_ME is not a client. Do not invent one.

export function driveClientConfigured(clientId) {
  const id = String(clientId || "").trim();
  if (!id.endsWith(".apps.googleusercontent.com")) return false;
  if (id.startsWith("REPLACE_ME")) return false;
  if (id.includes("YOUR_CLIENT") || id.includes("YOUR_EXTENSION")) return false;
  return true;
}
