#!/usr/bin/env node
// Prints the Worker's secrets as JSON on stdout, for piping straight into
// `wrangler secret bulk` (values never touch the terminal or a file):
//
//   node scripts/secretsJson.mjs | npx wrangler secret bulk --name iliad-ai
//
// Reads the git-ignored repo-root `.env.local` (0600):
//   GROQ_API_KEY
//   ILIAD_PROXY_SIGNING_KID, ILIAD_PROXY_SIGNING_KEY          (the signing kid)
//   ILIAD_PROXY_PREVIOUS_SIGNING_KID, ILIAD_PROXY_PREVIOUS_SIGNING_KEY,
//   ILIAD_PROXY_PREVIOUS_VERIFIES_UNTIL                         (optional, rotation grace)
//   ILIAD_PROXY_IP_HASH_KEY, ILIAD_PROXY_ADMIN_TOKEN
// Pass `--only NAME[,NAME]` to emit a subset (e.g. `--only TOKEN_SIGNING_KEYS`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = process.env.ILIAD_ENV_FILE ?? path.join(root, ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2].trim();
}

function required(name) {
  if (!env[name]) {
    console.error(`secretsJson: ${name} is missing from ${envPath}`);
    process.exit(1);
  }
  return env[name];
}

const signingKeys = { [required("ILIAD_PROXY_SIGNING_KID")]: { key: required("ILIAD_PROXY_SIGNING_KEY"), signs: true } };
if (env.ILIAD_PROXY_PREVIOUS_SIGNING_KID) {
  signingKeys[env.ILIAD_PROXY_PREVIOUS_SIGNING_KID] = {
    key: required("ILIAD_PROXY_PREVIOUS_SIGNING_KEY"),
    signs: false,
    ...(env.ILIAD_PROXY_PREVIOUS_VERIFIES_UNTIL ? { verifiesUntil: env.ILIAD_PROXY_PREVIOUS_VERIFIES_UNTIL } : {})
  };
}

const secrets = {
  GROQ_API_KEY: required("GROQ_API_KEY"),
  TOKEN_SIGNING_KEYS: JSON.stringify(signingKeys),
  IP_HASH_KEY: required("ILIAD_PROXY_IP_HASH_KEY"),
  ADMIN_TOKEN: required("ILIAD_PROXY_ADMIN_TOKEN")
};

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex > -1 ? new Set(process.argv[onlyIndex + 1].split(",")) : null;
process.stdout.write(JSON.stringify(only ? Object.fromEntries(Object.entries(secrets).filter(([name]) => only.has(name))) : secrets));
