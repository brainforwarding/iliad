import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { distributionUpdateOptions } from "../../electron/updates/distribution";

it("selects the release channel from build metadata rather than OS", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "iliad-channel-"));
  try {
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ iliadDistribution: "local" }));
    expect(await distributionUpdateOptions(directory, {})).toEqual({ releaseApiUrl: "" });
    expect(await distributionUpdateOptions(directory, { ILIAD_UPDATE_URL: "https://example.org/releases" })).toEqual({ releaseApiUrl: "https://example.org/releases" });
    await writeFile(path.join(directory, "package.json"), "{}");
    expect(await distributionUpdateOptions(directory, {})).toEqual({});
    expect(await distributionUpdateOptions(directory, { ILIAD_UPDATE_URL: "" })).toEqual({ releaseApiUrl: "" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
