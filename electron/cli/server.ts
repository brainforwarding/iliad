import { chmodSync, lstatSync, rmSync } from "node:fs";
import net from "node:net";
import { encodeCliResponse, maxCliRequestBytes, parseCliRequest, type CliRequest, type CliResponse } from "./protocol.js";

export type CliRequestHandler = (request: CliRequest) => Promise<CliResponse>;

export interface CliServer {
  socketPath: string;
  close: () => Promise<void>;
}

const requestReadTimeoutMs = 5_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Removes a socket left behind by a crashed run. Safe because the app's
 * single-instance lock guarantees this process is the only listener.
 */
export function removeStaleSocket(socketPath: string) {
  try {
    const stats = lstatSync(socketPath);

    if (stats.isDirectory()) {
      throw new Error(`Cannot create the CLI socket; a folder is in the way: ${socketPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }

  rmSync(socketPath, { force: true });
}

function handleConnection(socket: net.Socket, handler: CliRequestHandler) {
  let buffer = "";
  let received = false;

  const reply = (response: CliResponse) => {
    if (!socket.destroyed) {
      socket.end(encodeCliResponse(response));
    }
  };

  socket.setEncoding("utf8");
  socket.setTimeout(requestReadTimeoutMs, () => {
    if (!received) {
      reply({ ok: false, error: "No request received." });
    }
  });
  socket.on("error", () => {
    // The CLI went away; nothing to answer.
  });
  socket.on("data", (chunk: string) => {
    if (received) {
      return;
    }

    buffer += chunk;

    if (Buffer.byteLength(buffer) > maxCliRequestBytes) {
      received = true;
      reply({ ok: false, error: "Request is too large." });
      return;
    }

    const newline = buffer.indexOf("\n");

    if (newline < 0) {
      return;
    }

    received = true;
    socket.setTimeout(0);
    const parsed = parseCliRequest(buffer.slice(0, newline));

    if (!parsed.ok) {
      reply({ ok: false, error: parsed.error });
      return;
    }

    handler(parsed.request).then(reply, (error: unknown) => {
      reply({ ok: false, error: errorMessage(error) });
    });
  });
}

/**
 * Listens on a Unix domain socket for `iliad` CLI requests. The socket is
 * restricted to the current user (0600) as soon as it exists.
 */
export function startCliServer({ socketPath, handler }: { socketPath: string; handler: CliRequestHandler }): Promise<CliServer> {
  const isPipe = socketPath.startsWith("\\\\.\\pipe\\");
  if (!isPipe) removeStaleSocket(socketPath);
  const server = net.createServer((socket) => handleConnection(socket, handler));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);

      try {
        if (!isPipe) chmodSync(socketPath, 0o600);
      } catch (error) {
        server.close();
        reject(error);
        return;
      }

      let closed = false;
      resolve({
        socketPath,
        close: () =>
          new Promise<void>((closeResolve) => {
            if (closed) {
              closeResolve();
              return;
            }

            closed = true;
            server.close(() => closeResolve());
            // server.close removes the socket file on POSIX; make sure.
            if (!isPipe) rmSync(socketPath, { force: true });
          })
      });
    });
  });
}
