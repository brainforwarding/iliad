#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(process.argv[2] || packageJson.version || "").trim();
const latestMacPath = path.join(releaseDir, "latest-mac.yml");

function fail(message) {
  console.error(`update metadata refresh failed: ${message}`);
  process.exit(1);
}

function cleanValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function parseLatestMac(text) {
  const result = {
    path: "",
    files: []
  };

  for (const line of text.split(/\r?\n/)) {
    let match = /^\s*-\s+url:\s*(.+)$/.exec(line);
    if (match) {
      result.files.push(cleanValue(match[1]));
      continue;
    }

    match = /^path:\s*(.+)$/.exec(line);
    if (match) {
      result.path = cleanValue(match[1]);
    }
  }

  return result;
}

function releaseFile(relativePath) {
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

  const buffer = fs.readFileSync(filePath);
  return {
    url: relativePath,
    sha512: createHash("sha512").update(buffer).digest("base64"),
    size: buffer.length
  };
}

if (!version) {
  fail("package version is empty");
}

if (!fs.existsSync(latestMacPath)) {
  fail("release/latest-mac.yml is missing");
}

const latest = parseLatestMac(fs.readFileSync(latestMacPath, "utf8"));

if (!latest.path.endsWith(".zip")) {
  fail(`latest-mac.yml path must point to the macOS ZIP updater artifact, got ${latest.path || "(empty)"}`);
}

if (latest.files.length === 0) {
  fail("latest-mac.yml does not list any release files");
}

const files = latest.files.map((relativePath) => releaseFile(relativePath));
const pathFile = files.find((file) => file.url === latest.path) ?? releaseFile(latest.path);
const output = [
  `version: ${version}`,
  "files:",
  ...files.flatMap((file) => [`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`]),
  `path: ${latest.path}`,
  `sha512: ${pathFile.sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  ""
].join("\n");

fs.writeFileSync(latestMacPath, output);
console.log(`updated release/latest-mac.yml for Iliad MD ${version}`);
