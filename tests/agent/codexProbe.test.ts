import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeCodexCliProbeRequest,
  parseCodexVersion,
  probeCodexCliWithExec
} from "../../electron/agent/runtime/codexProbe";

describe("Codex CLI probe", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("normalizes probe requests and parses common version output", () => {
    expect(normalizeCodexCliProbeRequest({ executablePath: " /opt/homebrew/bin/codex ", timeoutMs: 2500 })).toEqual({
      executablePath: " /opt/homebrew/bin/codex ",
      timeoutMs: 2500
    });
    expect(normalizeCodexCliProbeRequest({ executablePath: 42, timeoutMs: Number.NaN })).toEqual({});
    expect(parseCodexVersion("codex-cli 1.2.3")).toBe("1.2.3");
    expect(parseCodexVersion("codex v2.0.0-beta.1")).toBe("2.0.0-beta.1");
  });

  it("runs only a no-shell version check with a minimal environment", async () => {
    process.env.OPENAI_API_KEY = "must-not-leak";
    const execFileImpl = vi.fn((_file, _args, options, callback) => {
      expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
      callback(null, "codex-cli 1.2.3\n", "");
    });

    const response = await probeCodexCliWithExec(
      {
        executablePath: "/usr/local/bin/codex",
        timeoutMs: 250
      },
      execFileImpl
    );

    expect(execFileImpl).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["--version"],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        timeout: 500
      }),
      expect.any(Function)
    );
    expect(response).toEqual({
      ok: true,
      executablePath: "/usr/local/bin/codex",
      version: "1.2.3",
      rawVersion: "codex-cli 1.2.3"
    });
  });

  it("rejects paths that do not look like Codex CLI executables", async () => {
    await expect(
      probeCodexCliWithExec({ executablePath: "node" }, vi.fn())
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid_path"
      }
    });

    await expect(
      probeCodexCliWithExec({ executablePath: "/usr/local/bin/node" }, vi.fn())
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "not_codex_executable"
      }
    });
  });

  it("maps missing executables without reading or storing credentials", async () => {
    const execFileImpl = vi.fn((_file, _args, _options, callback) => {
      const error = new Error("spawn ENOENT") as Error & { code: string };
      error.code = "ENOENT";
      callback(error, "", "");
    });

    await expect(probeCodexCliWithExec({ executablePath: "/usr/local/bin/codex" }, execFileImpl)).resolves.toEqual({
      ok: false,
      executablePath: "/usr/local/bin/codex",
      error: {
        code: "not_found",
        message: "Codex CLI was not found at that path.",
        detail: "spawn ENOENT",
        exitCode: undefined
      }
    });
  });
});
