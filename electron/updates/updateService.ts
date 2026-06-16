export const defaultUpdateReleaseApiUrl = "https://api.github.com/repos/brainforwarding/iliad/releases/latest";

export interface UpdateReleaseAsset {
  name: string;
  browserDownloadUrl: string;
}

export interface UpdateReleaseInfo {
  version: string;
  name: string;
  releaseDate: string;
  releaseUrl: string;
  notes: string;
  assets: UpdateReleaseAsset[];
}

export type UpdateCheckResult =
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      releaseName: string;
      releaseDate: string;
      releaseUrl: string;
      downloadUrl?: string;
      notes?: string;
    }
  | {
      status: "current";
      currentVersion: string;
      latestVersion: string;
      releaseUrl?: string;
    }
  | {
      status: "error";
      currentVersion: string;
      message: string;
      detail?: string;
    };

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: unknown;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  fetchImpl?: typeof fetch;
  releaseApiUrl?: string;
  arch?: NodeJS.Architecture;
  timeoutMs?: number;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function compareVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  if (!parsedLeft || !parsedRight) {
    throw new Error(`Unable to compare versions: ${left}, ${right}`);
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const difference = parsedLeft[key] - parsedRight[key];

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

export function releaseInfoFromGitHubPayload(payload: unknown): UpdateReleaseInfo {
  if (!payload || typeof payload !== "object") {
    throw new Error("GitHub release response was not an object.");
  }

  const release = payload as GitHubReleasePayload;
  const version = stringValue(release.tag_name).replace(/^v/i, "");
  const releaseUrl = stringValue(release.html_url);
  const releaseDate = stringValue(release.published_at);

  if (!parseVersion(version)) {
    throw new Error("GitHub release did not include a valid semantic version tag.");
  }

  if (!releaseUrl || !releaseUrl.startsWith("https://github.com/brainforwarding/iliad/releases/")) {
    throw new Error("GitHub release did not include the expected public release URL.");
  }

  if (!releaseDate || Number.isNaN(Date.parse(releaseDate))) {
    throw new Error("GitHub release did not include a valid publication date.");
  }

  const assets = Array.isArray(release.assets)
    ? release.assets
        .map((asset): UpdateReleaseAsset | null => {
          const source = asset as GitHubReleaseAsset;
          const name = stringValue(source.name);
          const browserDownloadUrl = stringValue(source.browser_download_url);

          if (!name || !browserDownloadUrl) {
            return null;
          }

          if (!browserDownloadUrl.startsWith("https://github.com/brainforwarding/iliad/releases/download/")) {
            return null;
          }

          return { name, browserDownloadUrl };
        })
        .filter((asset): asset is UpdateReleaseAsset => Boolean(asset))
    : [];

  return {
    version,
    name: stringValue(release.name) || `Iliad MD ${version}`,
    releaseDate,
    releaseUrl,
    notes: stringValue(release.body),
    assets
  };
}

export function selectMacDmgAsset(assets: UpdateReleaseAsset[], arch: NodeJS.Architecture = process.arch) {
  const dmgAssets = assets.filter((asset) => asset.name.toLowerCase().endsWith(".dmg"));
  const archName = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : "";

  if (archName) {
    const matchingArch = dmgAssets.find((asset) => asset.name.toLowerCase().includes(archName));

    if (matchingArch) {
      return matchingArch;
    }
  }

  return dmgAssets.find((asset) => !/(^|[-_.])(arm64|x64)([-_.]|$)/i.test(asset.name)) ?? null;
}

export class UpdateService {
  private readonly currentVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly releaseApiUrl: string;
  private readonly arch: NodeJS.Architecture;
  private readonly timeoutMs: number;

  constructor({
    currentVersion,
    fetchImpl = fetch,
    releaseApiUrl = defaultUpdateReleaseApiUrl,
    arch = process.arch,
    timeoutMs = 5000
  }: UpdateServiceOptions) {
    this.currentVersion = currentVersion;
    this.fetchImpl = fetchImpl;
    this.releaseApiUrl = releaseApiUrl;
    this.arch = arch;
    this.timeoutMs = timeoutMs;
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    let timeout: NodeJS.Timeout | null = null;

    try {
      if (!parseVersion(this.currentVersion)) {
        throw new Error(`Current app version is not a valid semantic version: ${this.currentVersion}`);
      }

      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const response = await this.fetchImpl(this.releaseApiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Iliad-MD/${this.currentVersion}`
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}.`);
      }

      const release = releaseInfoFromGitHubPayload(await response.json());
      const versionDelta = compareVersions(release.version, this.currentVersion);

      if (versionDelta <= 0) {
        return {
          status: "current",
          currentVersion: this.currentVersion,
          latestVersion: release.version,
          releaseUrl: release.releaseUrl
        };
      }

      const downloadAsset = selectMacDmgAsset(release.assets, this.arch);

      return {
        status: "available",
        currentVersion: this.currentVersion,
        latestVersion: release.version,
        releaseName: release.name,
        releaseDate: release.releaseDate,
        releaseUrl: release.releaseUrl,
        downloadUrl: downloadAsset?.browserDownloadUrl,
        notes: release.notes
      };
    } catch (error) {
      return {
        status: "error",
        currentVersion: this.currentVersion,
        message: "Could not check for updates.",
        detail: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
