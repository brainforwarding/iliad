import type { AgentModelId } from "../types/iliad";

export const agentModelOptions = [
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.4", label: "gpt-5.4" },
  { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { id: "gpt-5.3-codex", label: "gpt-5.3-codex" },
  { id: "gpt-5.3-codex-spark", label: "gpt-5.3-codex-spark" },
  { id: "gpt-5.2", label: "gpt-5.2" }
] as const satisfies Array<{ id: AgentModelId; label: string }>;
