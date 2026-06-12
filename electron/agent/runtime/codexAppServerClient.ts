import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  CodexAccount,
  CodexAccountConnectionError,
  CodexAccountRateLimitSummary,
  CodexAccountStatusResponse,
  CodexDeviceLoginResponse
} from "../types.js";

export const OPENAI_CODEX_DEVICE_URL = "https://auth.openai.com/codex/device";

export interface CodexAppServerClientOptions {
  userDataPath: string;
  executablePath?: string;
  requestTimeoutMs?: number;
  transportFactory?: CodexAppServerTransportFactory;
  onServerRequest?: CodexAppServerServerRequestHandler;
  onNotification?: CodexAppServerNotificationHandler;
}

export interface CodexAppServerTransport {
  stdin: Pick<NodeJS.WritableStream, "write">;
  stdout: Pick<NodeJS.ReadableStream, "on">;
  stderr: Pick<NodeJS.ReadableStream, "on">;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type CodexAppServerTransportFactory = (request: {
  executablePath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  codexHome: string;
}) => CodexAppServerTransport;

export type JsonRpcId = string | number;
export type JsonRpcMessage = Record<string, unknown>;

export interface CodexAppServerRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
  message: JsonRpcMessage;
}

export interface CodexAppServerNotification {
  method: string;
  params?: unknown;
  message: JsonRpcMessage;
}

export interface CodexAppServerRequestError {
  code: string | number;
  message: string;
  data?: unknown;
}

export type CodexAppServerRequestResponse =
  | {
      id: JsonRpcId;
      result: unknown;
    }
  | {
      id: JsonRpcId;
      error: CodexAppServerRequestError;
    };

export interface CodexAppServerRequestResponder {
  readonly responded: boolean;
  respond(response: CodexAppServerRequestResponse): void;
  respondResult(result: unknown): void;
  respondError(error: CodexAppServerRequestError): void;
}

export type CodexAppServerServerRequestHandler = (
  request: CodexAppServerRequest,
  responder: CodexAppServerRequestResponder
) => void | CodexAppServerRequestResponse | Promise<void | CodexAppServerRequestResponse>;

export type CodexAppServerNotificationHandler = (notification: CodexAppServerNotification) => void;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const defaultExecutablePath = "codex";
const defaultRequestTimeoutMs = 15_000;

export class CodexAppServerClient {
  private readonly executablePath: string;
  private readonly requestTimeoutMs: number;
  private readonly transportFactory: CodexAppServerTransportFactory;
  private readonly codexHome: string;
  private readonly serverRequestHandlers = new Set<CodexAppServerServerRequestHandler>();
  private readonly notificationHandlers = new Set<CodexAppServerNotificationHandler>();
  private transport: CodexAppServerTransport | null = null;
  private initializePromise: Promise<void> | null = null;
  private nextId = 1;
  private stdoutBuffer = "";
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private pendingLoginId: string | null = null;
  private disposed = false;

  constructor(options: CodexAppServerClientOptions) {
    this.executablePath = options.executablePath ?? defaultExecutablePath;
    this.requestTimeoutMs = clampRequestTimeoutMs(options.requestTimeoutMs);
    this.transportFactory = options.transportFactory ?? defaultTransportFactory;
    this.codexHome = path.join(options.userDataPath, "assistant", "codex-home");
    if (options.onServerRequest) {
      this.serverRequestHandlers.add(options.onServerRequest);
    }

    if (options.onNotification) {
      this.notificationHandlers.add(options.onNotification);
    }
  }

  async status(): Promise<CodexAccountStatusResponse> {
    try {
      await this.ensureInitialized();
      return await this.readStatus();
    } catch (error) {
      return unavailableStatus(this.pendingLoginId, normalizeCodexAppServerError(error));
    }
  }

  async startDeviceLogin(): Promise<CodexDeviceLoginResponse> {
    try {
      await this.ensureInitialized();
      const response = await this.sendRequest<unknown>("account/login/start", {
        type: "chatgptDeviceCode"
      });
      const login = normalizeDeviceLogin(response);

      if (!login) {
        return {
          ...(await this.readStatus()),
          error: {
            code: "protocol_error",
            message: "Codex did not return a valid device-code login."
          }
        };
      }

      this.pendingLoginId = login.loginId;
      const status = await this.readStatus();

      return {
        ...status,
        pendingLogin: true,
        login: {
          verificationUrl: login.verificationUrl,
          userCode: login.userCode
        }
      };
    } catch (error) {
      return unavailableDeviceLogin(this.pendingLoginId, normalizeCodexAppServerError(error));
    }
  }

  async cancelLogin(): Promise<CodexAccountStatusResponse> {
    try {
      await this.ensureInitialized();

      const loginId = this.pendingLoginId;

      if (loginId) {
        await this.sendRequest("account/login/cancel", { loginId });
      }

      this.pendingLoginId = null;
      return await this.readStatus();
    } catch (error) {
      return unavailableStatus(this.pendingLoginId, normalizeCodexAppServerError(error));
    }
  }

  async logout(): Promise<CodexAccountStatusResponse> {
    try {
      await this.ensureInitialized();
      this.pendingLoginId = null;
      await this.sendRequest("account/logout");
      const status = await this.readStatus();
      return {
        ...status,
        pendingLogin: false
      };
    } catch (error) {
      return unavailableStatus(this.pendingLoginId, normalizeCodexAppServerError(error));
    }
  }

  async startThread<T = unknown>(params: unknown): Promise<T> {
    return this.sendCodexRequest<T>("thread/start", params);
  }

  async startTurn<T = unknown>(params: unknown): Promise<T> {
    return this.sendCodexRequest<T>("turn/start", params);
  }

  async sendCodexRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureInitialized();
    return this.sendRequest<T>(method, params);
  }

  addServerRequestHandler(handler: CodexAppServerServerRequestHandler) {
    this.serverRequestHandlers.add(handler);
    return () => {
      this.serverRequestHandlers.delete(handler);
    };
  }

  addNotificationHandler(handler: CodexAppServerNotificationHandler) {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  dispose() {
    this.disposed = true;
    this.rejectAllPending(new CodexAppServerError("app_server_unavailable", "Codex app-server was closed."));
    this.initializePromise = null;
    this.pendingLoginId = null;

    if (this.transport) {
      this.transport.kill();
      this.transport = null;
    }
  }

  private async ensureInitialized() {
    if (this.disposed) {
      throw new CodexAppServerError("app_server_unavailable", "Codex app-server has been disposed.");
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.initialize();

    try {
      await this.initializePromise;
    } catch (error) {
      this.initializePromise = null;
      throw error;
    }
  }

  private async initialize() {
    await mkdir(this.codexHome, { recursive: true });
    this.startTransport();
    await this.sendRequest("initialize", {
      clientInfo: {
        name: "iliad",
        title: "Iliad",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.sendNotification("initialized");
  }

  private startTransport() {
    if (this.transport) {
      return;
    }

    const transport = this.transportFactory({
      executablePath: this.executablePath,
      args: ["app-server", "--listen", "stdio://"],
      env: safeCodexAppServerEnv(this.codexHome),
      codexHome: this.codexHome
    });

    transport.stdout.on("data", (chunk) => this.handleStdoutData(chunk));
    transport.stderr.on("data", () => {
      // Deliberately ignored. Codex app-server stderr may include sensitive paths
      // or future auth diagnostics; UI and logs use sanitized high-level errors.
    });
    transport.on("exit", () => this.handleTransportClosed());
    transport.on("error", () => this.handleTransportClosed());
    this.transport = transport;
  }

  private async readStatus(): Promise<CodexAccountStatusResponse> {
    const response = await this.sendRequest<unknown>("account/read", { refreshToken: false });
    const status = normalizeAccountRead(response, this.pendingLoginId);

    if (status.connected && status.account?.type === "chatgpt") {
      const rateLimits = await this.tryReadRateLimits();

      if (rateLimits) {
        status.rateLimits = rateLimits;
      }
    }

    return status;
  }

  private async tryReadRateLimits(): Promise<CodexAccountRateLimitSummary | undefined> {
    try {
      return normalizeRateLimits(await this.sendRequest<unknown>("account/rateLimits/read"));
    } catch {
      return undefined;
    }
  }

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (!this.transport) {
      throw new CodexAppServerError("app_server_unavailable", "Codex app-server is not running.");
    }

    const id = this.nextId++;
    const message: JsonRpcMessage = { id, method };

    if (params !== undefined) {
      message.params = params;
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new CodexAppServerError("request_timeout", "Codex app-server request timed out."));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      });

      this.writeMessage(message, reject);
    });
  }

  private sendNotification(method: string, params?: unknown) {
    const message: JsonRpcMessage = { method };

    if (params !== undefined) {
      message.params = params;
    }

    this.writeMessage(message, () => {
      // Notification send failures will surface through process exit/error.
    });
  }

  private writeMessage(message: JsonRpcMessage, reject: (error: Error) => void) {
    if (!this.transport) {
      reject(new CodexAppServerError("app_server_unavailable", "Codex app-server is not running."));
      return;
    }

    try {
      this.transport.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      reject(new CodexAppServerError("app_server_unavailable", "Could not write to Codex app-server."));
    }
  }

  private handleStdoutData(chunk: unknown) {
    this.stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");

      if (newlineIndex < 0) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (line) {
        this.handleProtocolLine(line);
      }
    }
  }

  private handleProtocolLine(line: string) {
    const message = parseProtocolMessage(line);

    if (!message) {
      return;
    }

    const id = jsonRpcId(message.id);
    const method = typeof message.method === "string" ? message.method : undefined;

    if (id !== undefined && method === undefined) {
      this.handleResponse(id, message);
      return;
    }

    if (id !== undefined && method !== undefined) {
      this.handleServerRequest({
        id,
        method,
        params: message.params,
        message
      });
      return;
    }

    if (method !== undefined) {
      this.handleNotification({
        method,
        params: message.params,
        message
      });
    }
  }

  private handleResponse(id: JsonRpcId, message: JsonRpcMessage) {
    const pending = this.pendingRequests.get(id);

    if (!pending) {
      return;
    }

    this.pendingRequests.delete(id);
    clearTimeout(pending.timeout);

    if (isRecord(message.error)) {
      pending.reject(rpcError(pending.method, message.error));
      return;
    }

    pending.resolve(message.result);
  }

  private handleServerRequest(request: CodexAppServerRequest) {
    const responder = new ServerRequestResponder(request.id, (response) => {
      this.writeMessage(response, () => {
        // A closed transport will also reject active outbound requests.
      });
    });

    const handlers = [...this.serverRequestHandlers];

    if (handlers.length === 0) {
      responder.respondError({
        code: -32601,
        message: `Unsupported Codex app-server request: ${request.method}`
      });
      return;
    }

    Promise.resolve()
      .then(async () => {
        for (const handler of handlers) {
          const response = await handler(request, responder);

          if (response && !responder.responded) {
            responder.respond(response);
          }

          if (responder.responded) {
            return;
          }
        }

        responder.respondError({
          code: -32601,
          message: `Unsupported Codex app-server request: ${request.method}`
        });
      })
      .catch(() => {
        if (!responder.responded) {
          responder.respondError({
            code: -32603,
            message: `Codex app-server request handler failed: ${request.method}`
          });
        }
      });
  }

  private handleNotification(notification: CodexAppServerNotification) {
    if (notification.method === "account/login/completed") {
      this.pendingLoginId = null;
    }

    if (notification.method === "account/updated" && !isRecord(notification.params)) {
      this.pendingLoginId = null;
    }

    try {
      for (const handler of this.notificationHandlers) {
        handler(notification);
      }
    } catch {
      // Notification observers must not disrupt protocol handling.
    }
  }

  private handleTransportClosed() {
    if (this.transport) {
      this.transport = null;
    }

    this.initializePromise = null;
    this.rejectAllPending(new CodexAppServerError("app_server_unavailable", "Codex app-server stopped."));
  }

  private rejectAllPending(error: Error) {
    for (const [id, pending] of this.pendingRequests) {
      this.pendingRequests.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }
}

class ServerRequestResponder implements CodexAppServerRequestResponder {
  private hasResponded = false;

  constructor(
    private readonly id: JsonRpcId,
    private readonly send: (response: CodexAppServerRequestResponse) => void
  ) {}

  get responded() {
    return this.hasResponded;
  }

  respond(response: CodexAppServerRequestResponse) {
    if (this.hasResponded) {
      return;
    }

    this.hasResponded = true;
    this.send({
      ...response,
      id: this.id
    });
  }

  respondResult(result: unknown) {
    this.respond({ id: this.id, result });
  }

  respondError(error: CodexAppServerRequestError) {
    this.respond({ id: this.id, error });
  }
}

export function safeCodexAppServerEnv(codexHome: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    windir: process.env.windir ?? "",
    CODEX_HOME: codexHome
  };
}

function defaultTransportFactory({
  executablePath,
  args,
  env
}: {
  executablePath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}): CodexAppServerTransport {
  return spawn(executablePath, args, {
    shell: false,
    windowsHide: true,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  } satisfies SpawnOptionsWithoutStdio) as ChildProcessWithoutNullStreams;
}

function normalizeAccountRead(response: unknown, pendingLoginId: string | null): CodexAccountStatusResponse {
  const record = isRecord(response) ? response : {};
  const account = normalizeAccount(record.account);

  return {
    available: true,
    connected: Boolean(account),
    requiresOpenaiAuth: Boolean(record.requiresOpenaiAuth),
    pendingLogin: Boolean(pendingLoginId),
    account
  };
}

function normalizeAccount(value: unknown): CodexAccount | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = value.type;

  if (type !== "chatgpt" && type !== "apiKey" && type !== "amazonBedrock") {
    return undefined;
  }

  const account: CodexAccount = { type };

  if (type === "chatgpt") {
    account.email = typeof value.email === "string" ? value.email : undefined;
    account.planType = typeof value.planType === "string" ? value.planType : undefined;
  }

  return account;
}

function normalizeDeviceLogin(response: unknown) {
  if (!isRecord(response)) {
    return null;
  }

  if (
    response.type !== "chatgptDeviceCode" ||
    response.verificationUrl !== OPENAI_CODEX_DEVICE_URL ||
    typeof response.userCode !== "string" ||
    typeof response.loginId !== "string"
  ) {
    return null;
  }

  return {
    verificationUrl: response.verificationUrl,
    userCode: response.userCode,
    loginId: response.loginId
  };
}

function normalizeRateLimits(response: unknown): CodexAccountRateLimitSummary | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const snapshot = selectRateLimitSnapshot(response);

  if (!snapshot) {
    return undefined;
  }

  return {
    limitId: stringOrNull(snapshot.limitId),
    limitName: stringOrNull(snapshot.limitName),
    planType: stringOrNull(snapshot.planType),
    primary: mapRateLimitWindow(snapshot.primary),
    secondary: mapRateLimitWindow(snapshot.secondary),
    rateLimitReachedType: stringOrNull(snapshot.rateLimitReachedType),
    credits: normalizeCredits(snapshot.credits)
  };
}

function selectRateLimitSnapshot(response: Record<string, unknown>) {
  const byLimitId = isRecord(response.rateLimitsByLimitId) ? response.rateLimitsByLimitId : null;

  if (byLimitId) {
    const codexSnapshot = byLimitId.codex;

    if (isRecord(codexSnapshot)) {
      return codexSnapshot;
    }

    const firstSnapshot = Object.values(byLimitId).find(isRecord);

    if (firstSnapshot) {
      return firstSnapshot;
    }
  }

  if (isRecord(response.rateLimits)) {
    return response.rateLimits;
  }

  return null;
}

function mapRateLimitWindow(window: unknown) {
  if (!isRecord(window)) {
    return undefined;
  }

  const resetsAtUnixSeconds = finiteNumberOrNull(window.resetsAt);

  return {
    usedPercent: finiteNumberOrNull(window.usedPercent),
    windowDurationMins: finiteNumberOrNull(window.windowDurationMins),
    resetsAtUnixSeconds,
    resetsAtIso: resetsAtUnixSeconds === null ? null : new Date(resetsAtUnixSeconds * 1000).toISOString()
  };
}

function normalizeCredits(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    hasCredits: booleanOrNull(value.hasCredits),
    unlimited: booleanOrNull(value.unlimited),
    balance: stringOrNull(value.balance)
  };
}

function unavailableStatus(
  pendingLoginId: string | null,
  error: CodexAccountConnectionError
): CodexAccountStatusResponse {
  return {
    available: false,
    connected: false,
    requiresOpenaiAuth: true,
    pendingLogin: Boolean(pendingLoginId),
    error
  };
}

function unavailableDeviceLogin(
  pendingLoginId: string | null,
  error: CodexAccountConnectionError
): CodexDeviceLoginResponse {
  return unavailableStatus(pendingLoginId, error);
}

function parseProtocolMessage(line: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jsonRpcId(value: unknown): JsonRpcId | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function rpcError(method: string, error: Record<string, unknown>) {
  const rawCode = error.code;
  const code = rawCode === -32601 ? "unsupported_method" : "protocol_error";
  return new CodexAppServerError(
    code,
    method === "account/rateLimits/read"
      ? "Codex rate-limit status is unavailable."
      : "Codex app-server returned an unexpected response."
  );
}

function normalizeCodexAppServerError(error: unknown): CodexAccountConnectionError {
  if (error instanceof CodexAppServerError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return {
    code: "unknown",
    message: "Codex account status is unavailable."
  };
}

class CodexAppServerError extends Error {
  constructor(
    readonly code: CodexAccountConnectionError["code"],
    message: string
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}

function clampRequestTimeoutMs(timeoutMs: number | undefined) {
  if (!timeoutMs || !Number.isFinite(timeoutMs)) {
    return defaultRequestTimeoutMs;
  }

  return Math.max(250, Math.min(timeoutMs, 60_000));
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
