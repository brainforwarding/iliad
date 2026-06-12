import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeAgentRunContextManifest } from "./contextManifest.js";
import type { AgentRunContextManifest } from "./types.js";

const MANIFEST_HISTORY_LIMIT = 200;

type ManifestMutation<T> = (manifests: AgentRunContextManifest[]) => Promise<T> | T;

export class AgentContextManifestStore {
  private readonly storePath: string;
  private readonly saltPath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly userDataPath: string) {
    this.storePath = path.join(userDataPath, "assistant", "context-manifests.json");
    this.saltPath = path.join(userDataPath, "assistant", "context-manifest-salt");
  }

  async workspaceId(workspaceRoot: string): Promise<string> {
    const salt = await this.readOrCreateSalt();
    const resolvedRoot = path.resolve(workspaceRoot);
    const digest = createHash("sha256").update(`${salt}:${resolvedRoot}`, "utf8").digest("hex");
    return `workspace_${digest.slice(0, 32)}`;
  }

  async saveManifest(manifest: AgentRunContextManifest): Promise<AgentRunContextManifest> {
    return this.mutate((manifests) => {
      const nextManifest = serializeAgentRunContextManifest(manifest);
      const index = manifests.findIndex((candidate) => candidate.runId === nextManifest.runId);

      if (index >= 0) {
        manifests[index] = nextManifest;
      } else {
        manifests.push(nextManifest);
      }

      return serializeAgentRunContextManifest(nextManifest);
    });
  }

  async updateManifest(
    runId: string,
    patch: Partial<AgentRunContextManifest>
  ): Promise<AgentRunContextManifest | null> {
    return this.mutate((manifests) => {
      const index = manifests.findIndex((candidate) => candidate.runId === runId);

      if (index < 0) {
        return null;
      }

      const nextManifest = serializeAgentRunContextManifest({
        ...manifests[index],
        ...patch,
        runId: manifests[index].runId,
        id: manifests[index].id,
        workspaceRootPersisted: false
      });
      manifests[index] = nextManifest;
      return serializeAgentRunContextManifest(nextManifest);
    });
  }

  async getManifest(runId: string): Promise<AgentRunContextManifest | null> {
    return this.enqueue(async () => {
      const manifests = await this.readAll();
      const manifest = manifests.find((candidate) => candidate.runId === runId);
      return manifest ? serializeAgentRunContextManifest(manifest) : null;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async mutate<T>(operation: ManifestMutation<T>): Promise<T> {
    return this.enqueue(async () => {
      const manifests = await this.readAll();
      const result = await operation(manifests);
      await this.writeAll(pruneManifests(manifests));
      return result;
    });
  }

  private async readAll(): Promise<AgentRunContextManifest[]> {
    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((manifest) => serializeAgentRunContextManifest(manifest as AgentRunContextManifest));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return [];
      }

      throw error;
    }
  }

  private async writeAll(manifests: AgentRunContextManifest[]) {
    await mkdir(path.dirname(this.storePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(manifests.map(serializeAgentRunContextManifest), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(tempPath, this.storePath);
  }

  private async readOrCreateSalt() {
    try {
      return (await readFile(this.saltPath, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const salt = randomBytes(32).toString("hex");
    await mkdir(path.dirname(this.saltPath), { recursive: true, mode: 0o700 });
    await writeFile(this.saltPath, `${salt}\n`, { encoding: "utf8", mode: 0o600 });
    return salt;
  }
}

function pruneManifests(manifests: AgentRunContextManifest[]) {
  return [...manifests]
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
    .slice(0, MANIFEST_HISTORY_LIMIT)
    .reverse();
}
