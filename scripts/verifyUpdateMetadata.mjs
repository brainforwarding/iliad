#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expectedVersion = String(process.argv[2] || packageJson.version || "").trim();
const latestMacPath = path.join(releaseDir, "latest-mac.yml");
const appUpdatePath = path.join(
  releaseDir,
  "mac-arm64",
  "Iliad MD.app",
  "Contents",
  "Resources",
  "app-update.yml"
);

function cleanValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function fail(message) {
  console.error(`update metadata check failed: ${message}`);
  process.exit(1);
}

function parseLatestMac(text) {
  const result = {
    version: "",
    path: "",
    sha512: "",
    releaseDate: "",
    files: []
  };
  let currentFile = null;

  for (const line of text.split(/\r?\n/)) {
    let match = /^version:\s*(.+)$/.exec(line);
    if (match) {
      result.version = cleanValue(match[1]);
      continue;
    }

    match = /^path:\s*(.+)$/.exec(line);
    if (match) {
      result.path = cleanValue(match[1]);
      continue;
    }

    match = /^sha512:\s*(.+)$/.exec(line);
    if (match) {
      result.sha512 = cleanValue(match[1]);
      continue;
    }

    match = /^releaseDate:\s*(.+)$/.exec(line);
    if (match) {
      result.releaseDate = cleanValue(match[1]);
      continue;
    }

    match = /^\s*-\s+url:\s*(.+)$/.exec(line);
    if (match) {
      currentFile = { url: cleanValue(match[1]), sha512: "", size: null };
      result.files.push(currentFile);
      continue;
    }

    match = /^\s+sha512:\s*(.+)$/.exec(line);
    if (match && currentFile) {
      currentFile.sha512 = cleanValue(match[1]);
      continue;
    }

    match = /^\s+size:\s*(\d+)\s*$/.exec(line);
    if (match && currentFile) {
      currentFile.size = Number(match[1]);
    }
  }

  return result;
}

function fileDigestBase64(filePath) {
  return createHash("sha512").update(fs.readFileSync(filePath)).digest("base64");
}

function verifyReleaseFile(relativePath, expectedSha512, expectedSize) {
  if (!relativePath) {
    fail("latest-mac.yml contains an empty artifact path");
  }

  if (/^https?:\/\//i.test(relativePath)) {
    fail(`latest-mac.yml should reference release assets by filename, not absolute URL: ${relativePath}`);
  }

  const filePath = path.join(releaseDir, relativePath);
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(`${releaseDir}${path.sep}`)) {
    fail(`latest-mac.yml references a file outside release/: ${relativePath}`);
  }

  if (!fs.existsSync(filePath)) {
    fail(`missing release artifact referenced by latest-mac.yml: release/${relativePath}`);
  }

  const stat = fs.statSync(filePath);
  if (Number.isFinite(expectedSize) && expectedSize !== null && stat.size !== expectedSize) {
    fail(`size mismatch for release/${relativePath}: latest-mac.yml=${expectedSize}, actual=${stat.size}`);
  }

  if (expectedSha512) {
    const actualSha512 = fileDigestBase64(filePath);
    if (actualSha512 !== expectedSha512) {
      fail(`sha512 mismatch for release/${relativePath}`);
    }
  }
}

if (!expectedVersion) {
  fail("package version is empty");
}

if (!fs.existsSync(latestMacPath)) {
  fail("release/latest-mac.yml is missing");
}

const latest = parseLatestMac(fs.readFileSync(latestMacPath, "utf8"));

if (latest.version !== expectedVersion) {
  fail(`latest-mac.yml version is ${latest.version || "(empty)"}, expected ${expectedVersion}`);
}

if (!latest.path.endsWith(".zip")) {
  fail(`latest-mac.yml path must point to the macOS ZIP updater artifact, got ${latest.path || "(empty)"}`);
}

if (!latest.releaseDate || Number.isNaN(Date.parse(latest.releaseDate))) {
  fail(`latest-mac.yml releaseDate is missing or invalid: ${latest.releaseDate || "(empty)"}`);
}

if (latest.files.length === 0) {
  fail("latest-mac.yml does not list any release files");
}

verifyReleaseFile(latest.path, latest.sha512, null);

for (const file of latest.files) {
  verifyReleaseFile(file.url, file.sha512, file.size);
}

if (!fs.existsSync(appUpdatePath)) {
  fail("packaged app is missing Contents/Resources/app-update.yml");
}

const appUpdate = fs.readFileSync(appUpdatePath, "utf8");
for (const expectedLine of ["provider: github", "owner: brainforwarding", "repo: iliad"]) {
  if (!appUpdate.includes(expectedLine)) {
    fail(`app-update.yml is missing '${expectedLine}'`);
  }
}

console.log(`update metadata check passed for Iliad MD ${expectedVersion}`);
