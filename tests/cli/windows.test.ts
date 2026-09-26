import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cliSocketPath } from "../../bin/lib/paths.mjs";
import { cliEndpoint } from "../../electron/cli/endpoint";
import { installWindowsCommand, uninstallWindowsCommand, updatePathValue } from "../../bin/lib/windowsInstall.mjs";
import { resolveLauncher } from "../../bin/lib/launcher.mjs";
import { startCliServer } from "../../electron/cli/server";
import { sendRequest } from "../../bin/lib/protocol.mjs";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), "iliad-win-test-")); directories.push(root); return root; }

describe("Windows CLI", () => {
  it("shares an endpoint between main and CLI and separates profiles", () => {
    const profile = path.resolve("user data á");
    expect(cliSocketPath({ platform: "win32", env: { ILIAD_USER_DATA: profile } })).toBe(cliEndpoint(profile, "win32"));
    expect(cliEndpoint(profile, "win32")).toBe(cliEndpoint(profile.toUpperCase(), "win32"));
    expect(cliEndpoint(profile, "win32")).not.toBe(cliEndpoint(profile + "-dev", "win32"));
    expect(cliEndpoint(profile, "win32", "alice")).not.toBe(cliEndpoint(profile, "win32", "bob"));
  });
  it("preserves unrelated PATH entries and avoids duplicate entries", () => {
    expect(updatePathValue("C:\\Tools;D:\\Stuff", "C:\\Iliad\\bin", true)).toBe("C:\\Tools;D:\\Stuff;C:\\Iliad\\bin");
    expect(updatePathValue("C:\\Tools;C:\\ILIAD\\bin", "c:\\iliad\\bin", true)).toBe("C:\\Tools;C:\\ILIAD\\bin");
    expect(updatePathValue("C:\\Tools;C:\\Iliad\\bin", "C:\\Iliad\\bin", false)).toBe("C:\\Tools");
  });
  it("installs idempotently and uninstalls only its own command and PATH entry", async () => {
    const directory = await fixture();
    let value = "C:\\Other";
    const pathStore = vi.fn(async (next?: string) => next === undefined ? value : (value = next));
    const wrapperPath = path.join(directory, "resources", "bin", "iliad.cmd");
    const result = await installWindowsCommand({ directory, wrapperPath, pathStore, pathValue: "" });
    expect(result.action).toBe("installed");
    expect(await readFile(result.linkPath, "utf8")).toContain("ELECTRON_RUN_AS_NODE=1");
    expect((await installWindowsCommand({ directory, wrapperPath, pathStore, pathValue: "" })).action).toBe("unchanged");
    expect((await uninstallWindowsCommand({ directories: [directory], pathStore, pathValue: "" })).removed).toEqual([result.linkPath]);
    expect(value).toBe("C:\\Other");
    await writeFile(result.linkPath, "@echo another command");
    await expect(installWindowsCommand({ directory, wrapperPath, pathStore, pathValue: "" })).rejects.toThrow(/not replaced/);
    expect((await uninstallWindowsCommand({ directories: [directory], pathStore, pathValue: "" })).skipped).toHaveLength(1);
    expect(await readFile(result.linkPath, "utf8")).toBe("@echo another command");
  });
  it("preserves a preexisting PATH entry on uninstall", async () => {
    const directory = await fixture();
    const pathStore = vi.fn(async () => directory);
    await installWindowsCommand({ directory, wrapperPath: path.join(directory, "resources/bin/iliad.cmd"), pathStore, pathValue: "" });
    await uninstallWindowsCommand({ directories: [directory], pathStore, pathValue: "" });
    expect(pathStore).toHaveBeenCalledTimes(1);
  });
  it("rolls back the shim and PATH ownership if the registry write fails", async () => {
    const directory = await fixture();
    const pathStore = async (next?: string) => { if (next !== undefined) throw new Error("registry denied"); return "C:\\Other"; };
    await expect(installWindowsCommand({ directory, wrapperPath: path.join(directory, "resources/bin/iliad.cmd"), pathStore, pathValue: "" })).rejects.toThrow("registry denied");
    await expect(readFile(path.join(directory, "iliad.cmd"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(directory, ".iliad-path-owned"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reports a foreign command earlier on PATH without replacing it", async () => {
    const directory = await fixture();
    const earlier = await fixture();
    const foreign = path.join(earlier, "iliad.cmd");
    await writeFile(foreign, "foreign");
    const result = await installWindowsCommand({ directory, wrapperPath: path.join(directory, "resources/bin/iliad.cmd"), pathStore: async () => directory, pathValue: earlier });
    expect(result.shadowedBy).toBe(foreign);
    expect(await readFile(foreign, "utf8")).toBe("foreign");
  });
  it("resolves packaged and development exe without spawning a cmd shim", () => {
    const root = "C:\\Iliad";
    const packaged = `${root}\\Iliad MD.exe`;
    const development = `${root}\\node_modules\\electron\\dist\\electron.exe`;
    const fs = { exists: (value: string) => [packaged, development].includes(value), isDirectory: () => false, listDirectory: () => [] };
    expect(resolveLauncher({ scriptDirectory: `${root}\\resources\\bin`, platform: "win32", env: {}, fs }).command).toBe(packaged);
    expect(resolveLauncher({ scriptDirectory: `${root}\\bin`, platform: "win32", env: {}, fs }).prefixArgs).toEqual([root]);
  });
  it.runIf(process.platform === "win32")("answers on a named pipe and can restart on the same endpoint", async () => {
    const endpoint = cliEndpoint(await fixture());
    for (let i = 0; i < 2; i++) {
      const server = await startCliServer({ socketPath: endpoint, handler: async () => ({ ok: true, windows: [] }) });
      try { expect(await sendRequest(endpoint, { cmd: "status" })).toEqual({ ok: true, windows: [] }); }
      finally { await server.close(); }
    }
  });
});
