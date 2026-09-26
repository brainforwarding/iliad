import { readFile } from "node:fs/promises";
import path from "node:path";

/** Release channel is build metadata, independent of the operating system. */
export async function distributionUpdateOptions(appPath: string, env = process.env) {
  if (env.ILIAD_UPDATE_URL !== undefined) return { releaseApiUrl: env.ILIAD_UPDATE_URL };
  const metadata = JSON.parse(await readFile(path.join(appPath, "package.json"), "utf8"));
  return metadata.iliadDistribution === "local" ? { releaseApiUrl: "" } : {};
}
