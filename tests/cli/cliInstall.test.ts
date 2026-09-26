import { execFile } from "node:child_process";
import { chmod, cp, lstat, mkdir, mkdtemp, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { installCommandFromResources, loadInstallModule } from "../../electron/cli/installCommand";
import { exitCodes, routeArgv, runCli } from "../../bin/lib/cli.mjs";
import {
  bundleWrapperPath,
  directoryIsOnPath,
  firstOnPath,
  installCliCommand,
  isIliadWrapperTarget,
  uninstallCliCommand
} from "../../bin/lib/install.mjs";

// Every test injects its folders and HOME: nothing here may touch the real
// /opt/homebrew/bin, /usr/local/bin or ~/.local/bin.
const repoRoot = path.resolve(__dirname, "../..");
const run = promisify(execFile);

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "iliad-install-")));
});

async function executable(filePath: string, body = "#!/bin/sh\n") {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
  await chmod(filePath, 0o755);
}

/** A fake `Iliad MD.app` whose Resources/bin holds a wrapper file. */
async function fakeBundle(root = dir) {
  const bin = path.join(root, "Iliad MD.app", "Contents", "Resources", "bin");
  await executable(path.join(bin, "iliad"));
  return { bin, wrapper: path.join(bin, "iliad") };
}

describe.skipIf(process.platform === "win32")("installCliCommand", () => {
  it("links into the first usable folder, is idempotent, and reports PATH membership", async () => {
    const readOnly = path.join(dir, "ro");
    const writable = path.join(dir, "rw");
    await mkdir(readOnly);
    await mkdir(writable);
    await chmod(readOnly, 0o500);
    const { wrapper } = await fakeBundle();

    const result = await installCliCommand({
      wrapperPath: wrapper,
      directories: [path.join(dir, "missing"), readOnly, writable],
      pathValue: `/usr/bin:${writable}`,
      createMissingDirectory: null
    });

    expect(result).toEqual({
      action: "installed",
      linkPath: path.join(writable, "iliad"),
      directory: writable,
      target: wrapper,
      onPath: true,
      shadowedBy: null
    });
    expect((await lstat(result.linkPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(result.linkPath)).toBe(wrapper);
    const before = await lstat(result.linkPath);

    const again = await installCliCommand({ wrapperPath: wrapper, directories: [writable], pathValue: "", createMissingDirectory: null });
    expect(again).toMatchObject({ action: "unchanged", onPath: false });
    // Unchanged means untouched: same inode.
    expect((await lstat(result.linkPath)).ino).toBe(before.ino);
  });

  it("never overwrites a real file and creates ~/.local/bin when needed", async () => {
    const taken = path.join(dir, "taken");
    await mkdir(taken);
    await writeFile(path.join(taken, "iliad"), "someone else's");
    const localBin = path.join(dir, "home", ".local", "bin");

    const result = await installCliCommand({
      wrapperPath: "/w",
      directories: [taken, localBin],
      pathValue: "/usr/bin",
      createMissingDirectory: localBin
    });

    expect(result).toMatchObject({ directory: localBin, onPath: false, action: "installed" });
    await expect(
      installCliCommand({ wrapperPath: "/w", directories: [taken], pathValue: "", createMissingDirectory: null })
    ).rejects.toThrow(/No writable folder/);
  });

  it("replaces only links to an Iliad wrapper, never another tool's `iliad` link", async () => {
    const foreign = path.join(dir, "foreign");
    const ours = path.join(dir, "ours");
    await mkdir(foreign);
    await mkdir(ours);
    await symlink("/usr/local/lib/other-tool/iliad", path.join(foreign, "iliad"));
    await symlink("/Applications/Old Iliad.app/Contents/Resources/bin/iliad", path.join(ours, "iliad"));
    const wrapper = "/Applications/Iliad MD.app/Contents/Resources/bin/iliad";

    const result = await installCliCommand({
      wrapperPath: wrapper,
      directories: [foreign, ours],
      pathValue: "",
      createMissingDirectory: null
    });

    expect(result).toMatchObject({ directory: ours, action: "installed" });
    expect(await readlink(path.join(ours, "iliad"))).toBe(wrapper);
    expect(await readlink(path.join(foreign, "iliad"))).toBe("/usr/local/lib/other-tool/iliad");
    expect(isIliadWrapperTarget("../lib/iliad", "/usr/local/bin", wrapper)).toBe(false);
    // Another app's bundled `iliad` is not ours.
    expect(isIliadWrapperTarget("/Applications/Other.app/Contents/Resources/bin/iliad", "/usr/local/bin", wrapper)).toBe(false);
    expect(isIliadWrapperTarget("/Applications/Iliad MD 2.app/Contents/Resources/bin/iliad", "/usr/local/bin", wrapper)).toBe(true);
    expect(isIliadWrapperTarget(wrapper, "/usr/local/bin", wrapper)).toBe(true);
  });

  it("with an exact folder, refuses a missing folder or a taken slot instead of falling back", async () => {
    const taken = path.join(dir, "taken");
    await mkdir(taken);
    await writeFile(path.join(taken, "iliad"), "x");
    const base = { wrapperPath: "/w", directories: [], pathValue: "", createMissingDirectory: null };

    await expect(installCliCommand({ ...base, exactDirectory: path.join(dir, "nope") })).rejects.toThrow(
      /Cannot install into .*nope: it is not a writable folder/
    );
    await expect(installCliCommand({ ...base, exactDirectory: taken })).rejects.toThrow(/another program's `iliad`/);
  });

  it("reports an earlier `iliad` on PATH that shadows the link", async () => {
    const early = path.join(dir, "early");
    const late = path.join(dir, "late");
    await executable(path.join(early, "iliad"), "#!/bin/sh\necho other\n");
    await mkdir(late);
    const { wrapper } = await fakeBundle();

    const shadowed = await installCliCommand({
      wrapperPath: wrapper,
      directories: [late],
      pathValue: `${early}:${late}`,
      createMissingDirectory: null
    });
    expect(shadowed.shadowedBy).toBe(path.join(early, "iliad"));
    expect(await firstOnPath(`${path.join(dir, "none")}:${late}`)).toBe(path.join(late, "iliad"));

    // A second link to the same wrapper earlier on PATH is not a shadow.
    const same = path.join(dir, "same");
    await mkdir(same);
    await symlink(wrapper, path.join(same, "iliad"));
    const notShadowed = await installCliCommand({
      wrapperPath: wrapper,
      directories: [late],
      pathValue: `${same}:${late}`,
      createMissingDirectory: null
    });
    expect(notShadowed).toMatchObject({ action: "unchanged", shadowedBy: null });
  });

  it("matches PATH entries exactly", () => {
    expect(directoryIsOnPath("/opt/homebrew/bin", "/usr/bin:/opt/homebrew/bin/")).toBe(true);
    expect(directoryIsOnPath("/opt/homebrew/bin", "/usr/bin:/opt/homebrew/sbin")).toBe(false);
  });
});

describe.skipIf(process.platform === "win32")("bundleWrapperPath", () => {
  it("returns the wrapper of an app bundle and refuses checkouts", async () => {
    const { bin, wrapper } = await fakeBundle();
    expect(await bundleWrapperPath(bin)).toBe(wrapper);
    await expect(bundleWrapperPath(path.join(repoRoot, "bin"))).rejects.toThrow(/works from the Iliad MD app/);
    await expect(bundleWrapperPath(path.join(dir, "Empty.app", "Contents", "Resources", "bin"))).rejects.toThrow(
      /works from the Iliad MD app/
    );
  });

  it("refuses App Translocation and any read-only volume (a mounted DMG), not a merely unwritable bundle", async () => {
    const options = { exists: () => true, resolve: async (p: string) => p };
    await expect(
      bundleWrapperPath("/private/var/folders/x/AppTranslocation/ABC/d/Iliad MD.app/Contents/Resources/bin", {
        ...options,
        probe: async () => null
      })
    ).rejects.toMatchObject({ code: "disk-image", message: expect.stringMatching(/disk image or a quarantined location/) });
    // A DMG mounted anywhere (here under /tmp) is read-only: EROFS.
    await expect(
      bundleWrapperPath("/tmp/iliad-dmg.x/Iliad MD.app/Contents/Resources/bin", { ...options, probe: async () => "EROFS" })
    ).rejects.toThrow(/Copy it to \/Applications first/);
    // Installed by another admin: not writable by this user, still a real install.
    expect(
      await bundleWrapperPath("/Applications/Iliad MD.app/Contents/Resources/bin", { ...options, probe: async () => "EACCES" })
    ).toBe("/Applications/Iliad MD.app/Contents/Resources/bin/iliad");
  });

  it("resolves a symlinked script folder to the real bundle before checking it", async () => {
    const { bin, wrapper } = await fakeBundle();
    const alias = path.join(dir, "alias-bin");
    await symlink(bin, alias);
    expect(await bundleWrapperPath(alias)).toBe(wrapper);
  });
});

describe.skipIf(process.platform === "win32")("uninstallCliCommand", () => {
  it("removes only Iliad links and keeps Homebrew's", async () => {
    const ours = path.join(dir, "local", "bin");
    const foreign = path.join(dir, "foreign", "bin");
    const brewPrefix = path.join(dir, "homebrew");
    const brewBin = path.join(brewPrefix, "bin");
    await mkdir(ours, { recursive: true });
    await mkdir(foreign, { recursive: true });
    await mkdir(brewBin, { recursive: true });
    await mkdir(path.join(brewPrefix, "Caskroom", "iliad-md"), { recursive: true });
    const wrapper = "/Applications/Iliad MD.app/Contents/Resources/bin/iliad";
    await symlink(wrapper, path.join(ours, "iliad"));
    await symlink("/usr/local/lib/other/iliad", path.join(foreign, "iliad"));
    await symlink(wrapper, path.join(brewBin, "iliad"));

    const result = await uninstallCliCommand({ directories: [ours, foreign, brewBin, path.join(dir, "missing")] });

    expect(result.removed).toEqual([path.join(ours, "iliad")]);
    expect(result.skipped).toEqual([{ linkPath: path.join(brewBin, "iliad"), reason: expect.stringMatching(/brew uninstall/) }]);
    await expect(lstat(path.join(ours, "iliad"))).rejects.toThrow();
    expect(await readlink(path.join(foreign, "iliad"))).toBe("/usr/local/lib/other/iliad");
    expect(await readlink(path.join(brewBin, "iliad"))).toBe(wrapper);
  });
});

describe.skipIf(process.platform === "win32")("iliad install / uninstall (runCli)", () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
  });

  const io = () => ({
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
    cwd: dir,
    home: dir,
    createMissingDirectory: null
  });

  it("routes install and uninstall options", () => {
    expect(routeArgv(["install"])).toEqual({ kind: "install", directory: null, json: false });
    expect(routeArgv(["install", "--dir", "b", "--json"])).toEqual({ kind: "install", directory: "b", json: true });
    expect(routeArgv(["install", "--dir=b"])).toEqual({ kind: "install", directory: "b", json: false });
    expect(routeArgv(["install", "--dir"]).kind).toBe("usage");
    expect(routeArgv(["install", "--dir", "--json"]).kind).toBe("usage");
    expect(routeArgv(["install", "extra"]).kind).toBe("usage");
    expect(routeArgv(["uninstall", "--json"])).toEqual({ kind: "uninstall", json: true });
    expect(routeArgv(["uninstall", "x"]).kind).toBe("usage");
    expect(routeArgv(["./install"])).toEqual({ kind: "launch", args: ["./install"] });
  });

  it("prints what it did, the PATH hint and the next step; exit 0", async () => {
    const { bin, wrapper } = await fakeBundle();
    const target = path.join(dir, "bin");
    await mkdir(target);
    const deps = { ...io(), scriptDirectory: bin, installDirectories: [target], pathValue: "/usr/bin" };

    expect(await runCli(["install"], deps)).toBe(exitCodes.ok);
    expect(out[0].split("\n")).toEqual([
      `Installed: ${path.join(target, "iliad")} -> ${wrapper}`,
      `${target} is not on your PATH. Add it to your shell profile, for example:`,
      `  export PATH="${target}:$PATH"`,
      "Next: `iliad skill install` adds the Iliad skill for Claude Code; other agents can use `iliad skill print`."
    ]);

    out.length = 0;
    expect(await runCli(["install"], { ...deps, pathValue: target })).toBe(exitCodes.ok);
    expect(out).toEqual([`Already installed: ${path.join(target, "iliad")} -> ${wrapper}`]);
  });

  it("--json reports success and failure as one object; failures exit 1", async () => {
    const { bin, wrapper } = await fakeBundle();
    const target = path.join(dir, "bin");
    await mkdir(target);

    expect(await runCli(["install", "--dir", "bin", "--json"], { ...io(), scriptDirectory: bin, pathValue: target })).toBe(0);
    expect(JSON.parse(out[0])).toEqual({
      ok: true,
      action: "installed",
      linkPath: path.join(target, "iliad"),
      directory: target,
      target: wrapper,
      onPath: true,
      shadowedBy: null
    });

    out.length = 0;
    expect(await runCli(["install", "--json"], { ...io(), scriptDirectory: path.join(repoRoot, "bin"), installDirectories: [target] })).toBe(
      exitCodes.error
    );
    expect(JSON.parse(out[0])).toEqual({ ok: false, code: "not-app-bundle", error: expect.stringMatching(/npm link/) });
    expect(err).toEqual([]);

    // Usage errors keep the one-JSON-object contract (exit 2).
    out.length = 0;
    expect(await runCli(["install", "--json", "--dir"], io())).toBe(exitCodes.usage);
    expect(JSON.parse(out[0])).toEqual({ ok: false, code: "usage", error: "--dir needs a folder." });
    expect(err).toEqual([]);
    out.length = 0;
    expect(
      await runCli(["install", "--dir", "missing", "--json"], { ...io(), scriptDirectory: bin, installDirectories: [target] })
    ).toBe(exitCodes.error);
    expect(JSON.parse(out[0])).toMatchObject({ ok: false, code: "folder-unusable" });

    expect(await runCli(["install"], { ...io(), scriptDirectory: path.join(repoRoot, "bin"), installDirectories: [target] })).toBe(1);
    expect(err[0]).toMatch(/^iliad: iliad install works from the Iliad MD app/);
    expect(await runCli(["install", "--nope"], io())).toBe(exitCodes.usage);
  });

  it("uninstall prints removed links or that there were none", async () => {
    const target = path.join(dir, "bin");
    await mkdir(target);
    await symlink("/Applications/Iliad MD.app/Contents/Resources/bin/iliad", path.join(target, "iliad"));

    expect(await runCli(["uninstall"], { ...io(), installDirectories: [target] })).toBe(0);
    expect(out).toEqual([`Removed: ${path.join(target, "iliad")}`]);
    out.length = 0;
    expect(await runCli(["uninstall", "--json"], { ...io(), installDirectories: [target] })).toBe(0);
    expect(JSON.parse(out[0])).toEqual({ ok: true, removed: [], skipped: [] });
    out.length = 0;
    expect(await runCli(["uninstall"], { ...io(), installDirectories: [target] })).toBe(0);
    expect(out).toEqual(["No Iliad command link found."]);
  });
});

describe.skipIf(process.platform === "win32")("menu item loader (electron/cli/installCommand.ts)", () => {
  it("loads the same bin/lib/install.mjs from a Resources folder", async () => {
    const module = await loadInstallModule(repoRoot);
    expect(typeof module.installCliCommand).toBe("function");
    await expect(loadInstallModule(path.join(dir, "nowhere"))).rejects.toThrow();
  });

  it("applies the same bundle checks as the CLI (a checkout is refused before anything is written)", async () => {
    // The success path uses the real system folders, so only the refusal is
    // exercised here; the shared installCliCommand is covered above.
    await expect(
      installCommandFromResources({ resourcesPath: repoRoot, home: path.join(dir, "home"), pathValue: "" })
    ).rejects.toThrow(/works from the Iliad MD app/);
  });
});

describe.skipIf(process.platform === "win32")("packaged wrapper end to end", () => {
  it("runs `iliad install --dir` through bin/iliad with the bundle's executable, then through the link", async () => {
    const contents = path.join(dir, "Iliad MD.app", "Contents");
    await cp(path.join(repoRoot, "bin"), path.join(contents, "Resources", "bin"), { recursive: true });
    await mkdir(path.join(contents, "MacOS"), { recursive: true });
    // Stand-in for the Electron executable in Node mode.
    await symlink(process.execPath, path.join(contents, "MacOS", "Iliad MD"));
    await cp(path.join(repoRoot, "resources", "skill"), path.join(contents, "Resources", "skill"), { recursive: true });
    const target = path.join(dir, "target-bin");
    await mkdir(target);
    const home = path.join(dir, "home");
    await mkdir(home);
    const env = { PATH: `${target}:/usr/bin:/bin`, HOME: home };
    const wrapper = path.join(contents, "Resources", "bin", "iliad");

    const installed = await run("/bin/sh", [wrapper, "install", "--dir", target, "--json"], { env, cwd: dir });
    expect(JSON.parse(installed.stdout)).toMatchObject({
      ok: true,
      action: "installed",
      linkPath: path.join(target, "iliad"),
      target: wrapper,
      onPath: true,
      shadowedBy: null
    });

    const viaLink = await run(path.join(target, "iliad"), ["--help"], { env, cwd: dir });
    expect(viaLink.stdout).toMatch(/iliad install \[--dir <folder>\] \[--json\]/);

    const skill = await run(path.join(target, "iliad"), ["skill", "install"], { env, cwd: dir });
    expect(skill.stdout.trim()).toBe(`Installed skill: ${path.join(home, ".claude", "skills", "iliad", "SKILL.md")}`);

    const again = await run(path.join(target, "iliad"), ["install", "--dir", target], { env, cwd: dir });
    expect(again.stdout.trim()).toBe(`Already installed: ${path.join(target, "iliad")} -> ${wrapper}`);
  }, 20_000);
});
