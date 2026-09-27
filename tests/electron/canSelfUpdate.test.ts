import { describe, expect, it } from "vitest";
import { canSelfUpdate } from "../../electron/updates/canSelfUpdate";

const exe = "/Applications/Iliad MD.app/Contents/MacOS/Iliad MD";

function options(overrides: Partial<Parameters<typeof canSelfUpdate>[0]> = {}) {
  return {
    isPackaged: true,
    platform: "darwin" as NodeJS.Platform,
    executablePath: exe,
    resolve: async (target: string) => target,
    probeWrite: async () => null,
    isDirectory: async () => true,
    ...overrides
  };
}

describe("canSelfUpdate", () => {
  it("accepts a packaged app in a writable folder (/Applications, ~/Applications, anywhere writable)", async () => {
    expect(await canSelfUpdate(options())).toEqual({ ok: true, appPath: "/Applications/Iliad MD.app" });
    expect(
      await canSelfUpdate(options({ executablePath: "/Users/me/Applications/Iliad MD.app/Contents/MacOS/Iliad MD" }))
    ).toMatchObject({ ok: true });
  });

  it("refuses development runs and other platforms", async () => {
    expect(await canSelfUpdate(options({ isPackaged: false }))).toEqual({ ok: false, reason: "not-packaged" });
    expect(await canSelfUpdate(options({ platform: "linux" }))).toEqual({ ok: false, reason: "not-macos" });
    expect(await canSelfUpdate(options({ executablePath: "/usr/local/bin/electron" }))).toEqual({
      ok: false,
      reason: "not-app-bundle"
    });
  });

  it("checks the resolved bundle path, so a translocated copy is refused", async () => {
    const translocated = "/private/var/folders/x/T/AppTranslocation/ABC/d/Iliad MD.app/Contents/MacOS/Iliad MD";
    expect(
      await canSelfUpdate(options({ executablePath: "/Applications/Iliad MD.app/Contents/MacOS/Iliad MD", resolve: async () => translocated }))
    ).toEqual({ ok: false, reason: "translocated" });
  });

  it("refuses a read-only volume (a mounted DMG) wherever it is mounted", async () => {
    expect(
      await canSelfUpdate(
        options({
          executablePath: "/Volumes/Iliad MD/Iliad MD.app/Contents/MacOS/Iliad MD",
          probeWrite: async (target) => (target.endsWith(".app") ? "EROFS" : null)
        })
      )
    ).toEqual({ ok: false, reason: "read-only-volume" });
  });

  it("refuses a bundle whose folder isn't writable", async () => {
    expect(
      await canSelfUpdate(options({ probeWrite: async (target) => (target === "/Applications" ? "EACCES" : null) }))
    ).toEqual({ ok: false, reason: "folder-not-writable" });
  });
});
