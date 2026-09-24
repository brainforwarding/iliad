import net from "node:net";

// Mirrors electron/cli/protocol.ts: one NDJSON request per connection,
// `{v:1, cmd, ...}` answered by `{ok:true, ...}` or `{ok:false, error}`.
export const protocolVersion = 1;
const maxResponseBytes = 1024 * 1024;

export function encodeRequest(request) {
  return `${JSON.stringify({ v: protocolVersion, ...request })}\n`;
}

export function decodeResponse(line) {
  let parsed;

  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: "Iliad sent an unreadable reply." };
  }

  if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
    return { ok: false, error: "Iliad sent an unreadable reply." };
  }

  if (!parsed.ok && typeof parsed.error !== "string") {
    return { ok: false, error: "Iliad reported an unknown error." };
  }

  return parsed;
}

export class NotRunningError extends Error {
  constructor(cause) {
    super("Iliad is not open.");
    this.name = "NotRunningError";
    this.cause = cause;
  }
}

function isNotRunningCode(code) {
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "ENOTSOCK";
}

/**
 * Sends one request over the app's Unix socket and resolves with the decoded
 * reply. Rejects with NotRunningError when nothing is listening.
 */
export function sendRequest(socketPath, request, { timeoutMs = 5000, connect = net.createConnection } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    let settled = false;
    let connected = false;

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      callback();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Iliad did not answer in time.")));
    }, timeoutMs);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      connected = true;
      socket.write(encodeRequest(request));
    });
    socket.on("data", (chunk) => {
      buffer += chunk;

      if (buffer.length > maxResponseBytes) {
        finish(() => reject(new Error("Iliad sent a reply that is too large.")));
        return;
      }

      const newline = buffer.indexOf("\n");

      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        finish(() => resolve(decodeResponse(line)));
      }
    });
    socket.on("end", () => {
      finish(() => {
        if (buffer.trim()) {
          resolve(decodeResponse(buffer));
        } else {
          reject(new Error("Iliad closed the connection without answering."));
        }
      });
    });
    socket.on("error", (error) => {
      finish(() => {
        if (!connected && isNotRunningCode(error.code)) {
          reject(new NotRunningError(error));
        } else {
          reject(error);
        }
      });
    });
  });
}
