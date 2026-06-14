export const defaultAgentModel = "gpt-5.5";

export const agentModelOptions = [
  { id: "gpt-5.5", label: "gpt-5.5" },
  { id: "gpt-5.4", label: "gpt-5.4" },
  { id: "gpt-5.4-mini", label: "gpt-5.4-mini" }
] as const;

export type AgentModelId = (typeof agentModelOptions)[number]["id"];

const allowedAgentModels = new Set<string>(agentModelOptions.map((option) => option.id));

export function normalizeAgentModel(value: string | undefined | null): AgentModelId {
  const model = value?.trim();
  return model && allowedAgentModels.has(model) ? (model as AgentModelId) : defaultAgentModel;
}
