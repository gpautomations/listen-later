// SPDX-License-Identifier: GPL-3.0-or-later
// Build: bundles src -> dist (unpacked extension), copies the ONNX Runtime wasm locally (MV3 forbids remote code),
// and adds COPYING + THIRD_PARTY.md to the package.
//
//   node build.mjs            -> dist/        (generic build; personal defaults from local.config.json if present)
//   STORE=1 node build.mjs    -> dist-store/  (Chrome Web Store build; always generic, ignores local.config.json)
//
// local.config.json is optional and never committed (see .gitignore / local.config.example.json):
//   { "defaultServer": "http://my-computer.local:7778", "serverName": "your home server" }
// It pre-fills the "Send to my phone" server and grants host access to it in the manifest.
// EXTRA_HOST_PERMISSIONS (comma-separated match patterns) is for local tests only. STORE=1 ignores it.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const STORE = process.env.STORE === "1";
const out = STORE ? "dist-store" : "dist";
const local = !STORE && fs.existsSync("local.config.json") ? JSON.parse(fs.readFileSync("local.config.json", "utf8")) : {};
const defaultServer = (local.defaultServer || "").replace(/\/+$/, "");
if (defaultServer) new URL(defaultServer); // validate
const serverName = local.serverName || "your Listen Later server";
const serverLabel = defaultServer ? `${serverName.replace(/^your /, "")} podcast feed` : "your own Listen Later server";

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "ort"), { recursive: true });
const common = {
  bundle: true, minify: true, legalComments: "linked", target: "chrome116", logLevel: "info",
  define: { __SERVER_NAME__: JSON.stringify(serverName), __SERVER_LABEL__: JSON.stringify(serverLabel) },
};
const empty = "./src/lib/empty.js";
await esbuild.build({ ...common, entryPoints: ["src/content.src.js"], outfile: `${out}/content.js`, format: "iife" });
await esbuild.build({ ...common, entryPoints: ["src/drive.js"], outfile: `${out}/drive.js`, format: "iife" });
await esbuild.build({
  ...common, entryPoints: ["src/offscreen.src.js"], outfile: `${out}/offscreen.js`, format: "esm",
  // Node-only branches of transformers.js and the Emscripten eSpeak NG module are never taken in the browser.
  alias: { path: empty, "fs/promises": empty, fs: empty, sharp: empty, "onnxruntime-node": empty, module: empty, url: empty, crypto: empty },
});

for (const f of ["background.js", "offscreen.html", "content.css", "options.html", "options.js", "grant.html", "grant.js", "drive.html"]) {
  let s = fs.readFileSync(`src/${f}`, "utf8");
  if (defaultServer && (f === "background.js" || f === "options.js")) s = s.replace('const DEFAULT_SERVER = "";', `const DEFAULT_SERVER = ${JSON.stringify(defaultServer)};`);
  if (defaultServer && f === "options.html") s = s.replace('placeholder="http://my-computer.local:7778"', `placeholder="${defaultServer}"`);
  fs.writeFileSync(`${out}/${f}`, s);
}
const manifest = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
if (defaultServer) {
  const u = new URL(defaultServer);
  manifest.host_permissions.push(`${u.protocol}//${u.hostname.toLowerCase()}/*`); // match patterns cover all ports
}
if (!STORE && process.env.EXTRA_HOST_PERMISSIONS) {
  for (const pattern of process.env.EXTRA_HOST_PERMISSIONS.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!manifest.host_permissions.includes(pattern)) manifest.host_permissions.push(pattern);
  }
}
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
fs.cpSync("src/icons", `${out}/icons`, { recursive: true });
const ortDir = "node_modules/@huggingface/transformers/dist";
for (const f of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) fs.copyFileSync(path.join(ortDir, f), `${out}/ort/${f}`);
for (const f of ["COPYING", "THIRD_PARTY.md"]) fs.copyFileSync(f, `${out}/${f}`);
console.log("built", out, defaultServer ? `(default server from local.config.json)` : "(generic)");
