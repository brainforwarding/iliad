import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { ensureInsideWorkspace, validatePlatformName } from "../../electron/fs/pathSafety";
import { selectPlatformAsset, UpdateService } from "../../electron/updates/updateService";

it.each(["CON", "nul.md", "LPT1.txt", "COM².md", "chapter.", "chapter ", "a:b.md", "a?.md"])("rejects Windows name %s", name => {
  expect(() => validatePlatformName(name, "win32")).toThrow(/Windows/);
});
it("allows Unicode and spaces within Windows names", () => {
  expect(() => validatePlatformName("Capítulo 1 🦉.md", "win32")).not.toThrow();
});
it("blocks an existing or new file behind an outside directory junction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "iliad-junction-"));
  try {
    const book = path.join(root, "book"), outside = path.join(root, "outside");
    await mkdir(book); await mkdir(outside);
    await symlink(outside, path.join(book, "link"), process.platform === "win32" ? "junction" : "dir");
    expect(() => ensureInsideWorkspace(book, path.join(book, "link", "new.md"))).toThrow(/outside/);
    expect(() => ensureInsideWorkspace(book, path.join(book, "new.md"))).not.toThrow();
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});
it("selects only the matching Windows architecture and never a DMG", () => {
  const assets = ["Iliad MD-0.3.2-win-x64.exe", "Iliad MD-0.3.2-mac-arm64.dmg"].map(name => ({ name, browserDownloadUrl: `https://example.org/${name}` }));
  expect(selectPlatformAsset(assets, "win32", "x64", "0.3.2")?.name).toMatch(/x64.exe$/);
  expect(selectPlatformAsset(assets, "win32", "arm64", "0.3.2")).toBeNull();
});
it("does not contact upstream for a local Windows build", async () => {
  const fetchImpl = vi.fn();
  const result = await new UpdateService({ currentVersion: "0.3.2", platform: "win32", releaseApiUrl: "", fetchImpl }).checkForUpdates();
  expect(result).toMatchObject({ status: "error", message: "Local build" });
  expect(fetchImpl).not.toHaveBeenCalled();
});
