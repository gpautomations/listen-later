// SPDX-License-Identifier: GPL-3.0-or-later
// Delete one hosted episode by id. Requires the operator token. Does not print the token.
//   ADMIN_TOKEN=... HOSTED_BASE_URL=https://... node hosted/scripts/takedown.mjs <id> [reason]

const base = (process.env.HOSTED_BASE_URL || "").replace(/\/+$/, "");
const token = process.env.ADMIN_TOKEN || "";
const id = process.argv[2] || "";
const reason = process.argv.slice(3).join(" ").slice(0, 500);

if (!base || !token || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
  console.error("Usage: ADMIN_TOKEN=... HOSTED_BASE_URL=https://host node hosted/scripts/takedown.mjs <episode-id> [reason]");
  process.exit(1);
}

const response = await fetch(base + "/api/takedown", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ id, reason }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(body.error || `takedown failed (${response.status})`);
  process.exit(1);
}
console.log("deleted", body.id);
