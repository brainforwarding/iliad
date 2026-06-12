import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAppServerClient,
  OPENAI_CODEX_DEVICE_URL,
  type CodexAppServerClientOptions,
  type CodexAppServerTransport,
  type CodexAppServerTransportFactory
} from "../../electron/agent/runtime/codexAppServerClient";

let tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_ACCESS_TOKEN;
  delete process.env.CHATGPT_AUTH_TOKEN;
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("Codex app-server client", () => {
  it("initializes, sends initialized, and reads account status with explicit refresh params", async () => {
    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.sendNotification("remoteControl/status/changed", { status: "disabled" });
        transport.sendRaw("{malformed-json\n");
        transport.sendResult(message.id, {
          userAgent: "iliad-test",
          codexHome: "/redacted",
          platformFamily: "unix",
          platformOs: "macos"
        });
      }

      if (message.method === "account/read") {
        transport.sendResult(message.id, {
          account: null,
          requiresOpenaiAuth: true
        });
      }
    });

    const status = await harness.client.status();

    expect(status).toEqual({
      available: true,
      connected: false,
      requiresOpenaiAuth: true,
      pendingLogin: false,
      account: undefined
    });
    expect(harness.messages[0]).toMatchObject({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "iliad",
          title: "Iliad",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
        }
      }
    });
    expect(harness.messages[1]).toEqual({ method: "initialized" });
    expect(harness.messages[2]).toEqual({
      id: 2,
      method: "account/read",
      params: { refreshToken: false }
    });
  });

  it("keeps the device login id in main while exposing only URL and code", async () => {
    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.sendResult(message.id, {});
      }

      if (message.method === "account/login/start") {
        transport.sendResult(message.id, {
          type: "chatgptDeviceCode",
          verificationUrl: OPENAI_CODEX_DEVICE_URL,
          userCode: "ABCD-EFGH",
          loginId: "secret-login-id"
        });
      }

      if (message.method === "account/read") {
        transport.sendResult(message.id, {
          account: null,
          requiresOpenaiAuth: true
        });
      }

      if (message.method === "account/login/cancel") {
        transport.sendResult(message.id, { status: "canceled" });
      }
    });

    const login = await harness.client.startDeviceLogin();
    const cancel = await harness.client.cancelLogin();

    expect(login.login).toEqual({
      verificationUrl: OPENAI_CODEX_DEVICE_URL,
      userCode: "ABCD-EFGH"
    });
    expect(JSON.stringify(login)).not.toContain("secret-login-id");
    expect(cancel.pendingLogin).toBe(false);
    expect(harness.messages).toContainEqual({
      id: 4,
      method: "account/login/cancel",
      params: { loginId: "secret-login-id" }
    });
  });

  it("maps ChatGPT account status and multi-bucket rate limits", async () => {
    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.sendResult(message.id, {});
      }

      if (message.method === "account/read") {
        transport.sendResult(message.id, {
          account: {
            type: "chatgpt",
            email: "person@example.com",
            planType: "plus"
          },
          requiresOpenaiAuth: false
        });
      }

      if (message.method === "account/rateLimits/read") {
        transport.sendResult(message.id, {
          rateLimits: {
            limitId: "codex",
            limitName: "Messages",
            planType: "plus",
            primary: {
              usedPercent: 41,
              windowDurationMins: 300,
              resetsAt: 1_710_000_000
            },
            secondary: {
              usedPercent: 12,
              windowDurationMins: 60,
              resetsAt: 1_710_003_600
            },
            credits: {
              hasCredits: true,
              unlimited: false,
              balance: "25"
            },
            rateLimitReachedType: null
          },
          rateLimitsByLimitId: {
            codex: {
              limitId: "codex",
              limitName: "Messages",
              planType: "plus",
              primary: {
                usedPercent: 41,
                windowDurationMins: 300,
                resetsAt: 1_710_000_000
              },
              secondary: {
                usedPercent: 12,
                windowDurationMins: 60,
                resetsAt: 1_710_003_600
              },
              credits: {
                hasCredits: true,
                unlimited: false,
                balance: "25"
              },
              rateLimitReachedType: null
            },
            codexOther: {
              limitId: "codexOther",
              limitName: "Other",
              primary: {
                usedPercent: 77,
                windowDurationMins: 60,
                resetsAt: 1_710_003_600
              },
              secondary: null,
              credits: null,
              planType: "plus",
              rateLimitReachedType: null
            }
          }
        });
      }
    });

    const status = await harness.client.status();

    expect(status.connected).toBe(true);
    expect(status.account).toEqual({
      type: "chatgpt",
      email: "person@example.com",
      planType: "plus"
    });
    expect(status.rateLimits).toMatchObject({
      limitId: "codex",
      limitName: "Messages",
      planType: "plus",
      primary: {
        usedPercent: 41,
        windowDurationMins: 300,
        resetsAtUnixSeconds: 1_710_000_000,
        resetsAtIso: "2024-03-09T16:00:00.000Z"
      },
      secondary: {
        usedPercent: 12,
        windowDurationMins: 60,
        resetsAtUnixSeconds: 1_710_003_600
      },
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "25"
      }
    });
  });

  it("spawns Codex with an app-scoped home and a strict non-auth environment", async () => {
    process.env.OPENAI_API_KEY = "must-not-leak";
    process.env.CODEX_ACCESS_TOKEN = "must-not-leak";
    process.env.CHATGPT_AUTH_TOKEN = "must-not-leak";

    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.sendResult(message.id, {});
      }

      if (message.method === "account/read") {
        transport.sendResult(message.id, {
          account: null,
          requiresOpenaiAuth: true
        });
      }
    });

    await harness.client.status();

    expect(harness.spawnRequest?.args).toEqual(["app-server", "--listen", "stdio://"]);
    expect(harness.spawnRequest?.env.CODEX_HOME).toBe(path.join(harness.userDataPath, "assistant", "codex-home"));
    expect(harness.spawnRequest?.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(harness.spawnRequest?.env).not.toHaveProperty("CODEX_ACCESS_TOKEN");
    expect(harness.spawnRequest?.env).not.toHaveProperty("CHATGPT_AUTH_TOKEN");
  });

  it("returns sanitized unavailable status when the child exits with pending requests", async () => {
    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.exit();
      }
    });

    const status = await harness.client.status();

    expect(status).toEqual({
      available: false,
      connected: false,
      requiresOpenaiAuth: true,
      pendingLogin: false,
      error: {
        code: "app_server_unavailable",
        message: "Codex app-server stopped."
      }
    });
    expect(JSON.stringify(status)).not.toContain("CODEX_HOME");
  });

  it("logs out then refreshes status before reporting disconnected", async () => {
    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.sendResult(message.id, {});
      }

      if (message.method === "account/logout") {
        transport.sendNotification("account/updated", {});
        transport.sendResult(message.id, {});
      }

      if (message.method === "account/read") {
        transport.sendResult(message.id, {
          account: null,
          requiresOpenaiAuth: true
        });
      }
    });

    const status = await harness.client.logout();

    expect(status.connected).toBe(false);
    expect(harness.messages.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "account/logout",
      "account/read"
    ]);
  });

  it("sends generic runtime thread and turn requests after initialization", async () => {
    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.sendResult(message.id, {});
      }

      if (message.method === "thread/start") {
        transport.sendResult(message.id, { threadId: "thread-1" });
      }

      if (message.method === "turn/start") {
        transport.sendResult(message.id, { turnId: "turn-1" });
      }
    });

    await expect(harness.client.startThread({ cwd: "/workspace" })).resolves.toEqual({ threadId: "thread-1" });
    await expect(harness.client.startTurn({ threadId: "thread-1", input: "Summarize" })).resolves.toEqual({
      turnId: "turn-1"
    });

    expect(harness.messages).toContainEqual({
      id: 2,
      method: "thread/start",
      params: { cwd: "/workspace" }
    });
    expect(harness.messages).toContainEqual({
      id: 3,
      method: "turn/start",
      params: { threadId: "thread-1", input: "Summarize" }
    });
  });

  it("dispatches id+method server requests separately from client request responses", async () => {
    const serverRequests: Array<{ id: string | number; method: string; params: unknown }> = [];
    const harness = await createHarness(
      (message, transport) => {
        if (message.method === "initialize") {
          transport.sendResult(message.id, {});
        }

        if (message.method === "account/read") {
          transport.sendServerRequest("server-request-1", "item/permissions/requestApproval", {
            permission: "network"
          });
          transport.sendResult(message.id, {
            account: null,
            requiresOpenaiAuth: true
          });
        }
      },
      {
        onServerRequest: (request, responder) => {
          serverRequests.push({ id: request.id, method: request.method, params: request.params });
          responder.respondError({ code: "unsupported_permission", message: "Permission requests are not supported." });
        }
      }
    );

    const status = await harness.client.status();
    await flushProtocolHandlers();

    expect(status.available).toBe(true);
    expect(serverRequests).toEqual([
      {
        id: "server-request-1",
        method: "item/permissions/requestApproval",
        params: { permission: "network" }
      }
    ]);
    expect(harness.messages).toContainEqual({
      id: "server-request-1",
      error: {
        code: "unsupported_permission",
        message: "Permission requests are not supported."
      }
    });
  });

  it("supports string ids when responding to file-change approval requests", async () => {
    const harness = await createHarness(
      (message, transport) => {
        if (message.method === "initialize") {
          transport.sendResult(message.id, {});
        }

        if (message.method === "account/read") {
          transport.sendServerRequest("file-approval-1", "item/fileChange/requestApproval", {
            path: "notes.md"
          });
          transport.sendResult(message.id, {
            account: null,
            requiresOpenaiAuth: true
          });
        }
      },
      {
        onServerRequest: (request, responder) => {
          expect(request.id).toBe("file-approval-1");
          responder.respondResult({ decision: "decline" });
        }
      }
    );

    await harness.client.status();
    await flushProtocolHandlers();

    expect(harness.messages).toContainEqual({
      id: "file-approval-1",
      result: { decision: "decline" }
    });
  });

  it("lets approval callbacks return full envelopes for command execution requests", async () => {
    const harness = await createHarness(
      (message, transport) => {
        if (message.method === "initialize") {
          transport.sendResult(message.id, {});
        }

        if (message.method === "account/read") {
          transport.sendServerRequest(47, "item/commandExecution/requestApproval", {
            command: "ls"
          });
          transport.sendResult(message.id, {
            account: null,
            requiresOpenaiAuth: true
          });
        }
      },
      {
        onServerRequest: (request) => ({
          id: request.id,
          result: { decision: "decline" }
        })
      }
    );

    await harness.client.status();
    await flushProtocolHandlers();

    expect(harness.messages).toContainEqual({
      id: 47,
      result: { decision: "decline" }
    });
  });

  it("notifies listeners about incoming runtime notifications", async () => {
    const notifications: Array<{ method: string; params: unknown }> = [];
    const harness = await createHarness(
      (message, transport) => {
        if (message.method === "initialize") {
          transport.sendNotification("turn/started", { turnId: "turn-1" });
          transport.sendNotification("item/reasoning/summaryTextDelta", { delta: "Thinking" });
          transport.sendResult(message.id, {});
        }

        if (message.method === "account/read") {
          transport.sendResult(message.id, {
            account: null,
            requiresOpenaiAuth: true
          });
        }
      },
      {
        onNotification: (notification) => {
          notifications.push({ method: notification.method, params: notification.params });
        }
      }
    );

    await harness.client.status();

    expect(notifications).toEqual([
      { method: "turn/started", params: { turnId: "turn-1" } },
      { method: "item/reasoning/summaryTextDelta", params: { delta: "Thinking" } }
    ]);
  });

  it("kills the app-server transport on dispose", async () => {
    const harness = await createHarness((message, transport) => {
      if (message.method === "initialize") {
        transport.sendResult(message.id, {});
      }

      if (message.method === "account/read") {
        transport.sendResult(message.id, {
          account: null,
          requiresOpenaiAuth: true
        });
      }
    });

    await harness.client.status();
    harness.client.dispose();

    expect(harness.transport.killCount).toBe(1);
  });
});

async function createHarness(
  onMessage: (message: Record<string, any>, transport: FakeTransport) => void,
  options: Pick<CodexAppServerClientOptions, "onServerRequest" | "onNotification"> = {}
) {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "iliad-codex-app-server-"));
  tempDirs.push(userDataPath);

  const messages: Array<Record<string, any>> = [];
  const transport = new FakeTransport((message) => {
    messages.push(message);
    onMessage(message, transport);
  });
  let spawnRequest:
    | {
        executablePath: string;
        args: string[];
        env: NodeJS.ProcessEnv;
        codexHome: string;
      }
    | undefined;
  const transportFactory: CodexAppServerTransportFactory = (request) => {
    spawnRequest = request;
    return transport;
  };
  const client = new CodexAppServerClient({
    userDataPath,
    transportFactory,
    requestTimeoutMs: 500,
    ...options
  });

  return {
    userDataPath,
    client,
    messages,
    transport,
    get spawnRequest() {
      return spawnRequest;
    }
  };
}

class FakeTransport extends EventEmitter implements CodexAppServerTransport {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killCount = 0;

  readonly stdin = {
    write: (chunk: string) => {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();

        if (trimmed) {
          this.onMessage(JSON.parse(trimmed));
        }
      }

      return true;
    }
  };

  constructor(private readonly onMessage: (message: Record<string, any>) => void) {
    super();
  }

  sendResult(id: unknown, result: unknown) {
    this.sendRaw(`${JSON.stringify({ id, result })}\n`);
  }

  sendNotification(method: string, params?: unknown) {
    this.sendRaw(`${JSON.stringify({ method, params })}\n`);
  }

  sendServerRequest(id: string | number, method: string, params?: unknown) {
    this.sendRaw(`${JSON.stringify({ id, method, params })}\n`);
  }

  sendRaw(chunk: string) {
    this.stdout.emit("data", chunk);
  }

  exit() {
    this.emit("exit", 1, null);
  }

  kill() {
    this.killCount += 1;
    return true;
  }
}

async function flushProtocolHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
}
