// The only logger in the Worker (a test fails on any other `console.` use in
// src/). Its type accepts enum codes and numbers only, so no request body,
// prompt, output, token, IP or provider error text can be passed to it.
// Observability is off in wrangler.toml; this reaches only `wrangler tail`.

import type { ProxyErrorCode } from "./errors.js";

export type LogCode =
  | ProxyErrorCode
  | "upstream_status"
  | "usage_over_reservation"
  | "settle_failed"
  | "quota_unreachable"
  | "invalid_config";

export interface LogEvent {
  code: LogCode;
  status?: number;
}

export type Logger = (event: LogEvent) => void;

export const structuredLog: Logger = (event) => {
  // Rebuild the object from typed fields only: nothing else can slip through.
  const line: { code: LogCode; status?: number } = { code: event.code };
  if (typeof event.status === "number" && Number.isFinite(event.status)) line.status = event.status;
  console.log(JSON.stringify(line));
};
