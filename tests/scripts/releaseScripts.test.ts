import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";

// The release scripts resolve everything from their own location, so each test
// runs a copy of the script inside a throwaway repo layout.
const repoRoot = path.resolve(__dirname, "../..");
const run = promisify(execFile);
const version = "9.8.7";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "iliad-release-")));
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "release"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
});

async function script(name: string) {
  await copyFile(path.join(repoRoot, "scripts", name), path.join(root, "scripts", name));
  return path.join(root, "scripts", name);
}

async function runScript(name: string) {
  try {
    const { stdout, stderr } = await run(process.execPath, [await script(name)], { cwd: root });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

const sha512 = (data: string) => createHash("sha512").update(data).digest("base64");

/** A release/ folder that passes the verifier, before the stable DMG copy. */
async function releaseFolder({ stableDmgInMetadata = false } = {}) {
  const zip = `Iliad-MD-${version}-mac-arm64.zip`;
  const dmg = `Iliad-MD-${version}-mac-arm64.dmg`;
  await writeFile(path.join(root, "release", zip), "zip-bytes");
  await writeFile(path.join(root, "release", dmg), "dmg-bytes");
  const listed = [zip, dmg, ...(stableDmgInMetadata ? ["Iliad-MD-arm64.dmg"] : [])];
  if (stableDmgInMetadata) {
    await writeFile(path.join(root, "release", "Iliad-MD-arm64.dmg"), "dmg-bytes");
  }
  const files = await Promise.all(
    listed.map(async (name) => {
      const data = await readFile(path.join(root, "release", name), "utf8");
      return [`  - url: ${name}`, `    sha512: ${sha512(data)}`, `    size: ${Buffer.byteLength(data)}`].join("\n");
    })
  );
  await writeFile(
    path.join(root, "release", "latest-mac.yml"),
    [`version: ${version}`, "files:", ...files, `path: ${zip}`, `sha512: ${sha512("zip-bytes")}`, "releaseDate: '2026-09-25T00:00:00.000Z'", ""].join(
      "\n"
    )
  );
  const resources = path.join(root, "release", "mac-arm64", "Iliad MD.app", "Contents", "Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(path.join(resources, "app-update.yml"), "owner: brainforwarding\nrepo: iliad\nprovider: github\n");
  return { dmg };
}

describe("release:verify-update-metadata and the stable DMG", () => {
  it("passes when Iliad-MD-arm64.dmg is a byte-identical copy of the versioned DMG", async () => {
    const { dmg } = await releaseFolder();
    await copyFile(path.join(root, "release", dmg), path.join(root, "release", "Iliad-MD-arm64.dmg"));

    const result = await runScript("verifyUpdateMetadata.mjs");
    expect(result.stderr).toBe("");
    expect(result).toMatchObject({ code: 0, stdout: expect.stringMatching(/check passed for Iliad MD 9\.8\.7/) });
  });

  it("fails when the stable DMG is missing or stale", async () => {
    await releaseFolder();
    expect(await runScript("verifyUpdateMetadata.mjs")).toMatchObject({ code: 1, stderr: expect.stringMatching(/missing stable DMG/) });

    await writeFile(path.join(root, "release", "Iliad-MD-arm64.dmg"), "pre-staple-bytes");
    expect(await runScript("verifyUpdateMetadata.mjs")).toMatchObject({ code: 1, stderr: expect.stringMatching(/differs from/) });
  });

  it("fails when latest-mac.yml references the stable DMG", async () => {
    await releaseFolder({ stableDmgInMetadata: true });
    expect(await runScript("verifyUpdateMetadata.mjs")).toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/must not reference the stable Iliad-MD-arm64\.dmg/)
    });
  });
});

describe("release:update-homebrew-cask", () => {
  it("rewrites version and sha256 from the release DMG and leaves the rest", async () => {
    await mkdir(path.join(root, "packaging", "homebrew"), { recursive: true });
    const cask = await readFile(path.join(repoRoot, "packaging", "homebrew", "iliad-md.rb"), "utf8");
    await writeFile(path.join(root, "packaging", "homebrew", "iliad-md.rb"), cask);
    await writeFile(path.join(root, "release", `Iliad-MD-${version}-mac-arm64.dmg`), "dmg-bytes");

    const result = await runScript("updateHomebrewCask.mjs");
    expect(result.code).toBe(0);
    const updated = await readFile(path.join(root, "packaging", "homebrew", "iliad-md.rb"), "utf8");
    const sha256 = createHash("sha256").update("dmg-bytes").digest("hex");
    expect(updated.replaceAll("\r\n", "\n")).toContain(`  version "${version}"\n`);
    expect(updated.replaceAll("\r\n", "\n")).toContain(`  sha256 "${sha256}"\n`);
    expect(updated.replace(/version "[^"]*"/, "").replace(/sha256 "[^"]*"/, "")).toBe(
      cask.replace(/version "[^"]*"/, "").replace(/sha256 "[^"]*"/, "")
    );
  });

  it("fails without the release DMG", async () => {
    await mkdir(path.join(root, "packaging", "homebrew"), { recursive: true });
    await copyFile(path.join(repoRoot, "packaging", "homebrew", "iliad-md.rb"), path.join(root, "packaging", "homebrew", "iliad-md.rb"));
    expect(await runScript("updateHomebrewCask.mjs")).toMatchObject({ code: 1, stderr: expect.stringMatching(/missing release\//) });
  });
});

describe("packaging/homebrew/iliad-md.rb", () => {
  it("links the bundled CLI and downloads the versioned DMG", async () => {
    const cask = await readFile(path.join(repoRoot, "packaging", "homebrew", "iliad-md.rb"), "utf8");
    expect(cask).toMatch(/^cask "iliad-md" do$/m);
    expect(cask).toContain('app "Iliad MD.app"');
    expect(cask).toContain('binary "#{appdir}/Iliad MD.app/Contents/Resources/bin/iliad"');
    expect(cask).toContain("/releases/download/v#{version}/Iliad-MD-#{version}-mac-arm64.dmg");
    // The app only notifies about updates; brew upgrade must keep working.
    expect(cask).not.toMatch(/auto_updates/);
  });
});
