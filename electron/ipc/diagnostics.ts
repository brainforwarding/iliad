import { BrowserWindow, ipcMain } from "electron";
import type {
  DiagnosticDetailValue,
  DiagnosticLogArea,
  DiagnosticLogLevel,
  DiagnosticsLogger
} from "../diagnostics/logger.js";

interface RegisterDiagnosticsIpcOptions {
  logger: DiagnosticsLogger;
}

interface RendererDiagnosticLogRequest {
  level?: unknown;
  area?: unknown;
  event?: unknown;
  details?: unknown;
}

const levels = new Set<DiagnosticLogLevel>(["debug", "info", "warn", "error"]);
const areas = new Set<DiagnosticLogArea>(["app", "workspace", "agent", "provider", "review"]);

export function registerDiagnosticsIpc({ logger }: RegisterDiagnosticsIpcOptions) {
  ipcMain.handle("diagnostics:log", (event, request: RendererDiagnosticLogRequest) => {
    if (!BrowserWindow.fromWebContents(event.sender)) {
      return;
    }

    const record = normalizeRendererDiagnostic(request);

    if (!record) {
      return;
    }

    logger.log({
      ...record,
      details: {
        ...record.details,
        source: "renderer",
        webContentsId: event.sender.id
      }
    });
  });
}

function normalizeRendererDiagnostic(request: RendererDiagnosticLogRequest | null | undefined) {
  if (!request || typeof request !== "object") {
    return null;
  }

  const level = typeof request.level === "string" && levels.has(request.level as DiagnosticLogLevel) ? request.level : "info";
  const area = typeof request.area === "string" && areas.has(request.area as DiagnosticLogArea) ? request.area : "app";
  const event = typeof request.event === "string" && request.event.trim() ? request.event.trim() : null;

  if (!event) {
    return null;
  }

  return {
    level: level as DiagnosticLogLevel,
    area: area as DiagnosticLogArea,
    event,
    details: normalizeDetails(request.details)
  };
}

function normalizeDetails(details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }

  const normalized: Record<string, DiagnosticDetailValue> = {};

  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
