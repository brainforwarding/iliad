// Wire format for the `iliad` CLI socket (mirrored in bin/lib/protocol.mjs):
// one newline-terminated JSON request per connection, `{v:1, cmd, ...}`,
// answered by one line `{ok:true, ...}` or `{ok:false, error}`.

export const cliProtocolVersion = 1;
export const maxCliRequestBytes = 64 * 1024;

export interface CliWindowStatus {
  workspace: string | null;
  document: string | null;
  relativePath: string | null;
  focused: boolean;
}

export type CliRequest =
  | { cmd: "status" }
  /**
   * `path` is the path as the writer spelled it (absolute, symlinks kept);
   * `canonicalPath` is the CLI's realpath of it. Main checks hidden/ignored
   * names on every spelling.
   */
  | { cmd: "open"; path: string; canonicalPath?: string; line: number | null };

export type CliResponse =
  | { ok: true; windows?: CliWindowStatus[] }
  | { ok: false; error: string };

export type ParsedCliRequest = { ok: true; request: CliRequest } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCliRequest(line: string): ParsedCliRequest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: "Request is not valid JSON." };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "Request must be a JSON object." };
  }

  if (parsed.v !== cliProtocolVersion) {
    return { ok: false, error: `Unsupported protocol version; this Iliad speaks v${cliProtocolVersion}. Update the iliad command.` };
  }

  if (parsed.cmd === "status") {
    return { ok: true, request: { cmd: "status" } };
  }

  if (parsed.cmd === "open") {
    if (typeof parsed.path !== "string" || !parsed.path.trim()) {
      return { ok: false, error: "open needs a file path." };
    }

    const line = parsed.line;

    if (line !== undefined && line !== null && !(typeof line === "number" && Number.isInteger(line) && line >= 1)) {
      return { ok: false, error: "line must be a whole number of 1 or more." };
    }

    const canonicalPath = parsed.canonicalPath;

    if (canonicalPath !== undefined && (typeof canonicalPath !== "string" || !canonicalPath.trim())) {
      return { ok: false, error: "canonicalPath must be a file path." };
    }

    return {
      ok: true,
      request: {
        cmd: "open",
        path: parsed.path,
        ...(typeof canonicalPath === "string" ? { canonicalPath } : {}),
        line: typeof line === "number" ? line : null
      }
    };
  }

  return { ok: false, error: `Unknown command: ${typeof parsed.cmd === "string" ? parsed.cmd : "(none)"}` };
}

export function encodeCliResponse(response: CliResponse) {
  return `${JSON.stringify(response)}\n`;
}
