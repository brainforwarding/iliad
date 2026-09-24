import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { guiEnvironment, launchApp, resolveLauncher } from "../../bin/lib/launcher.mjs";

function fakeFs(files: string[], directories: string[] = []) {
  return {
    exists: (target: string) => files.includes(target) || directories.includes(target),
    isDirectory: (target: string) => directories.includes(target),
    listDirectory: (target: string) =>
      files.filter((file) => file.startsWith(`${target}/`)).map((file) => file.slice(target.length + 1))
  };
}

describe("resolveLauncher", () => {
  it("launches the enclosing app when the script lives in its bundle", () => {
    const app = "/Applications/Iliad MD.app";
    const launcher = resolveLauncher({
      scriptDirectory: `${app}/Contents/Resources/bin`,
      env: {},
      platform: "darwin",
      home: "/Users/w",
      execPath: `${app}/Contents/MacOS/Iliad MD`,
      fs: fakeFs([`${app}/Contents/MacOS/Iliad MD`], [app])
    });

    expect(launcher).toMatchObject({ kind: "app", source: "bundle", command: `${app}/Contents/MacOS/Iliad MD`, prefixArgs: [] });
  });

  it("finds a renamed bundle's executable without relying on execPath", () => {
    const app = "/Users/w/Downloads/Iliad Copy.app";
    const launcher = resolveLauncher({
      scriptDirectory: `${app}/Contents/Resources/bin`,
      env: {},
      platform: "darwin",
      home: "/Users/w",
      execPath: "/usr/local/bin/node",
      fs: fakeFs([`${app}/Contents/MacOS/Iliad MD`], [app])
    });

    expect(launcher.command).toBe(`${app}/Contents/MacOS/Iliad MD`);
  });

  it("launches the checkout's Electron when the script lives in a checkout", () => {
    const launcher = resolveLauncher({
      scriptDirectory: "/Users/w/dev/iliad/bin",
      env: {},
      platform: "darwin",
      home: "/Users/w",
      fs: fakeFs(["/Users/w/dev/iliad/node_modules/.bin/electron", "/Applications/Iliad MD.app/Contents/MacOS/Iliad MD"], [
        "/Applications/Iliad MD.app"
      ])
    });

    expect(launcher).toEqual({
      kind: "checkout",
      source: "checkout",
      command: "/Users/w/dev/iliad/node_modules/.bin/electron",
      prefixArgs: ["/Users/w/dev/iliad"],
      appPath: "/Users/w/dev/iliad"
    });
  });

  it("lets ILIAD_APP override the script location", () => {
    const app = "/tmp/Other.app";
    const launcher = resolveLauncher({
      scriptDirectory: "/Users/w/dev/iliad/bin",
      env: { ILIAD_APP: app },
      platform: "darwin",
      home: "/Users/w",
      fs: fakeFs(["/Users/w/dev/iliad/node_modules/.bin/electron", `${app}/Contents/MacOS/Iliad MD`], [app])
    });

    expect(launcher).toMatchObject({ source: "ILIAD_APP", command: `${app}/Contents/MacOS/Iliad MD` });

    expect(() =>
      resolveLauncher({ scriptDirectory: "/x/bin", env: { ILIAD_APP: "/nope.app" }, platform: "darwin", home: "/Users/w", fs: fakeFs([]) })
    ).toThrow(/ILIAD_APP/);
  });

  it("falls back to the installed app, then fails clearly", () => {
    const app = "/Applications/Iliad MD.app";
    expect(
      resolveLauncher({
        scriptDirectory: "/usr/local/lib/somewhere/bin",
        env: {},
        platform: "darwin",
        home: "/Users/w",
        fs: fakeFs([`${app}/Contents/MacOS/Iliad MD`], [app])
      }).source
    ).toBe("installed");

    expect(() =>
      resolveLauncher({ scriptDirectory: "/x/bin", env: {}, platform: "darwin", home: "/Users/w", fs: fakeFs([]) })
    ).toThrow(/Could not find the Iliad app/);
  });
});

describe("launchApp", () => {
  it("scrubs ELECTRON_RUN_AS_NODE from the GUI app's environment", () => {
    expect(guiEnvironment({ ELECTRON_RUN_AS_NODE: "1", HOME: "/Users/w" })).toEqual({ HOME: "/Users/w" });
  });

  it("spawns detached with the launcher prefix and the given args", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    await launchApp(
      { command: "/e/electron", prefixArgs: ["/repo"] },
      ["/Users/w/book"],
      { cwd: "/Users/w", env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/bin" }, spawnProcess }
    );

    expect(spawnProcess).toHaveBeenCalledWith("/e/electron", ["/repo", "/Users/w/book"], {
      cwd: "/Users/w",
      detached: true,
      env: { PATH: "/bin" },
      stdio: "ignore",
      windowsHide: true
    });
    expect(child.unref).toHaveBeenCalled();
  });

  it("rejects when the executable cannot start", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    });

    await expect(launchApp({ command: "/nope", prefixArgs: [] }, [], { spawnProcess })).rejects.toThrow(/Could not start Iliad/);
  });
});
