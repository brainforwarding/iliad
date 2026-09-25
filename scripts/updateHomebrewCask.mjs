#!/usr/bin/env node
// Points packaging/homebrew/iliad-md.rb at this release: rewrites its
// `version` and `sha256` from package.json and the final, stapled
// release/Iliad-MD-X.Y.Z-mac-arm64.dmg. Copy the result to the tap
// (brainforwarding/homebrew-tap, Casks/iliad-md.rb) after the GitHub release
// is live. See docs/release.md.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(process.argv[2] || packageJson.version || "").trim();
const caskPath = path.join(root, "packaging", "homebrew", "iliad-md.rb");
const dmgName = `Iliad-MD-${version}-mac-arm64.dmg`;
const dmgPath = path.join(root, "release", dmgName);

function fail(message) {
  console.error(`homebrew cask update failed: ${message}`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`not a release version: ${version || "(empty)"}`);
}

if (!fs.existsSync(dmgPath)) {
  fail(`missing release/${dmgName}`);
}

if (!fs.existsSync(caskPath)) {
  fail("missing packaging/homebrew/iliad-md.rb");
}

const sha256 = createHash("sha256").update(fs.readFileSync(dmgPath)).digest("hex");
const cask = fs.readFileSync(caskPath, "utf8");
const versionLine = /^(\s*)version "[^"]*"$/m;
const shaLine = /^(\s*)sha256 "[0-9a-f]{64}"$/m;

if (!versionLine.test(cask) || !shaLine.test(cask)) {
  fail("could not find the version and sha256 lines in packaging/homebrew/iliad-md.rb");
}

fs.writeFileSync(
  caskPath,
  cask.replace(versionLine, `$1version "${version}"`).replace(shaLine, `$1sha256 "${sha256}"`)
);
console.log(`updated packaging/homebrew/iliad-md.rb to ${version} (sha256 ${sha256})`);
