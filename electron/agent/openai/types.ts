import type { AgentRuntimeDiagnosticEvent } from "../runtime/provider.js";

export interface OpenAiTextItem {
  type?: string;
  text?: string;
}

export interface OpenAiOutputItem extends Record<string, unknown> {
  type?: string;
  content?: OpenAiTextItem[];
  summary?: OpenAiTextItem[];
  name?: string;
  arguments?: string;
  call_id?: string;
}

export interface OpenAiResponse {
  id?: string;
  output_text?: string;
  output?: OpenAiOutputItem[];
  error?: {
    message?: string;
  };
}

export interface OpenAiRequestOptions {
  reasoning: boolean;
  textVerbosity: boolean;
  tools?: boolean;
  toolChoice?: "auto" | "none";
  input?: string | OpenAiInputItem[];
}

export type OpenAiInputItem = Record<string, unknown>;

export type OpenAiDiagnosticEvent = AgentRuntimeDiagnosticEvent;

export type OpenAiDiagnosticEventListener = (event: OpenAiDiagnosticEvent) => void;

export interface OpenAiStreamSummary {
  raw: string;
  emitted: string;
  lastEmitAt: number;
}
