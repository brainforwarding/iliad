import { describe, expect, it } from "vitest";
import { agentErrorDiagnostic, normalizeAgentError, type AgentError } from "../../electron/writing/errors";

const providerUnavailable: AgentError = {
  code: "provider_unavailable",
  userMessage: "Provider unavailable.",
  retryable: true
};

describe("writing AI error diagnostics", () => {
  it("uses the provider-neutral AI_ diagnostic prefix and keeps safe details", () => {
    expect(agentErrorDiagnostic(providerUnavailable)).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(agentErrorDiagnostic({ ...providerUnavailable, detail: "proxy_error" })).toBe("AI_PROVIDER_UNAVAILABLE proxy_error");
    expect(agentErrorDiagnostic({ ...providerUnavailable, code: "free_quota_exhausted" })).toBe("AI_FREE_QUOTA_EXHAUSTED");
  });

  it("never mentions a removed provider in user messages", () => {
    const samples = [
      normalizeAgentError(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
      normalizeAgentError(Object.assign(new TypeError("fetch failed"))),
      normalizeAgentError(new Error("boom"))
    ];

    for (const sample of samples) {
      expect(sample.userMessage).not.toMatch(/openai|codex|gemini/i);
    }
  });
});
