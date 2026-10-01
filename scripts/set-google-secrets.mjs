// Sends the Google client ID and secret from Google's downloaded JSON file to
// Cloudflare as Worker secrets, so they are a matching pair and never pasted by hand.
//
//   node scripts/set-google-secrets.mjs                 (newest client_secret_*.json in Downloads)
//   node scripts/set-google-secrets.mjs path\to\file.json
//
// Prints names only, never values. Delete the JSON file afterwards.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function newestDownload() {
  const dir = join(homedir(), "Downloads");
  const files = readdirSync(dir)
    .filter((n) => /^client_secret_.*\.json$/i.test(n))
    .map((n) => join(dir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) throw new Error(`No client_secret_*.json file found in ${dir}. Download it from Google Cloud > Clients first.`);
  return files[0];
}

const file = process.argv[2] || newestDownload();
const web = JSON.parse(readFileSync(file, "utf8")).web;
if (!web) throw new Error("This file is not a Web application client (no \"web\" section).");
const { client_id, client_secret } = web;
if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(client_id || "")) throw new Error("client_id is missing or malformed in the file.");
if (typeof client_secret !== "string" || client_secret.length < 10) throw new Error("client_secret is missing from the file. In Google Cloud, add a new secret and download the JSON again.");

for (const [name, value] of [["GOOGLE_CLIENT_ID", client_id], ["GOOGLE_CLIENT_SECRET", client_secret]]) {
  const r = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", "put", name], { input: value, encoding: "utf8" });
  const ok = r.status === 0 && /Success/.test(r.stdout);
  console.log(`${ok ? "OK    " : "FAILED"} ${name}`);
  if (!ok) {
    console.log((r.stdout + r.stderr).split("\n").filter((l) => !l.includes(value)).slice(-8).join("\n"));
    process.exit(1);
  }
}
console.log("\nBoth secrets set from the same Google client. Now delete the downloaded JSON file.");
