import { describe, expect, it, vi } from "vitest";
import {
  UpdateService,
  compareVersions,
  releaseInfoFromGitHubPayload,
  selectMacDmgAsset
} from "../../electron/updates/updateService";

function githubRelease(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.2.7",
    name: "Iliad MD 0.2.7",
    html_url: "https://github.com/brainforwarding/iliad/releases/tag/v0.2.7",
    published_at: "2026-06-16T12:00:00Z",
    body: "Small update.",
    assets: [
      {
        name: "Iliad MD-0.2.7-mac-arm64.dmg",
        browser_download_url:
          "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/Iliad%20MD-0.2.7-mac-arm64.dmg"
      },
      {
        name: "Iliad MD-0.2.7-mac-arm64.zip",
        browser_download_url:
          "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/Iliad%20MD-0.2.7-mac-arm64.zip"
      }
    ],
    ...overrides
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

describe("UpdateService", () => {
  it("compares semantic versions with optional v prefixes", () => {
    expect(compareVersions("v0.2.7", "0.2.6")).toBeGreaterThan(0);
    expect(compareVersions("0.2.6", "0.2.6")).toBe(0);
    expect(compareVersions("0.2.5", "0.2.6")).toBeLessThan(0);
  });

  it("normalizes GitHub latest-release payloads", () => {
    const release = releaseInfoFromGitHubPayload(
      githubRelease({
        assets: [
          {
            name: "Iliad MD-0.2.7-mac-arm64.dmg",
            browser_download_url:
              "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/Iliad%20MD-0.2.7-mac-arm64.dmg"
          },
          {
            name: "other-site.dmg",
            browser_download_url: "https://example.com/other-site.dmg"
          }
        ]
      })
    );

    expect(release).toMatchObject({
      version: "0.2.7",
      name: "Iliad MD 0.2.7",
      releaseUrl: "https://github.com/brainforwarding/iliad/releases/tag/v0.2.7"
    });
    expect(release.assets).toEqual([
      {
        name: "Iliad MD-0.2.7-mac-arm64.dmg",
        browserDownloadUrl:
          "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/Iliad%20MD-0.2.7-mac-arm64.dmg"
      }
    ]);
  });

  it("selects a matching macOS DMG asset for the current architecture", () => {
    const assets = [
      {
        name: "Iliad MD-0.2.7-mac-x64.dmg",
        browserDownloadUrl: "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/x64.dmg"
      },
      {
        name: "Iliad MD-0.2.7-mac-arm64.dmg",
        browserDownloadUrl: "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/arm64.dmg"
      }
    ];

    expect(selectMacDmgAsset(assets, "arm64")?.name).toBe("Iliad MD-0.2.7-mac-arm64.dmg");
    expect(selectMacDmgAsset(assets, "x64")?.name).toBe("Iliad MD-0.2.7-mac-x64.dmg");
  });

  it("does not fall back to the wrong architecture-specific DMG", () => {
    const assets = [
      {
        name: "Iliad MD-0.2.7-mac-arm64.dmg",
        browserDownloadUrl: "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/arm64.dmg"
      }
    ];

    expect(selectMacDmgAsset(assets, "x64")).toBeNull();
  });

  it("returns available with a download URL when the latest release is newer", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(githubRelease()));
    const service = new UpdateService({ currentVersion: "0.2.6", fetchImpl, arch: "arm64" });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: "available",
      currentVersion: "0.2.6",
      latestVersion: "0.2.7",
      downloadUrl:
        "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/Iliad%20MD-0.2.7-mac-arm64.dmg"
    });
  });

  it("returns current when the latest release is not newer", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(githubRelease({ tag_name: "v0.2.6" })));
    const service = new UpdateService({ currentVersion: "0.2.6", fetchImpl, arch: "arm64" });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: "current",
      currentVersion: "0.2.6",
      latestVersion: "0.2.6"
    });
  });

  it("returns an error state when GitHub cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "rate limited" }, 403));
    const service = new UpdateService({ currentVersion: "0.2.6", fetchImpl, arch: "arm64" });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: "error",
      currentVersion: "0.2.6",
      message: "Could not check for updates."
    });
  });

  it("times out hung update checks", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    ) as typeof fetch;
    const service = new UpdateService({ currentVersion: "0.2.6", fetchImpl, arch: "arm64", timeoutMs: 1 });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: "error",
      currentVersion: "0.2.6",
      message: "Could not check for updates.",
      detail: "aborted"
    });
  });
});
