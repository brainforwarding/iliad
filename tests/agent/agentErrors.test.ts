import { describe, expect, it } from "vitest";
import { agentErrorDiagnostic } from "../../electron/agent/errors";
import type { AgentError } from "../../electron/agent/types";

const providerUnavailable: AgentError = {
  code: "provider_unavailable",
  userMessage: "Provider unavailable.",
  retryable: true
};

describe("agent error diagnostics", () => {
  it("uses provider-aware diagnostic prefixes", () => {
    expect(agentErrorDiagnostic(providerUnavailable, "codex-app-server")).toBe("CODEX_PROVIDER_UNAVAILABLE");
    expect(agentErrorDiagnostic(providerUnavailable, "openai-api")).toBe("OPENAI_PROVIDER_UNAVAILABLE");
    expect(agentErrorDiagnostic(providerUnavailable)).toBe("AGENT_PROVIDER_UNAVAILABLE");
  });

  it("keeps safe details after the provider-aware prefix", () => {
    expect(
      agentErrorDiagnostic(
        {
          ...providerUnavailable,
          detail: "insufficient_quota"
        },
        "codex-app-server"
      )
    ).toBe("CODEX_PROVIDER_UNAVAILABLE insufficient_quota");
  });
});
