import { describe, expect, it } from "vitest";
import { agentErrorDiagnostic, normalizeAgentError, type AgentError } from "../../electron/writing/errors";

const providerUnavailable: AgentError = {
  code: "provider_unavailable",
  userMessage: "Provider unavailable.",
  retryable: true
};

describe("writing AI error diagnostics", () => {
  it("uses the Gemini diagnostic prefix and keeps safe details", () => {
    expect(agentErrorDiagnostic(providerUnavailable)).toBe("GEMINI_PROVIDER_UNAVAILABLE");
    expect(agentErrorDiagnostic({ ...providerUnavailable, detail: "quota" })).toBe("GEMINI_PROVIDER_UNAVAILABLE quota");
  });

  it("never mentions a removed provider in user messages", () => {
    const samples = [
      normalizeAgentError(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
      normalizeAgentError(Object.assign(new TypeError("fetch failed"))),
      normalizeAgentError(new Error("boom"))
    ];

    for (const sample of samples) {
      expect(sample.userMessage).not.toMatch(/openai|codex/i);
    }
  });
});
