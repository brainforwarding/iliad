import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { agentModelOptions } from "../../src/assistant/agentModels";
import {
  AssistantSettings,
  getRemotePairingDisplayValue,
  getValidTelegramPairingUrl
} from "../../src/components/assistant/AssistantSettings";
import {
  canSendChat,
  type CodexConnectionState,
  type TelegramRemoteConnectionState
} from "../../src/assistant/useAssistantRun";
import { appStrings } from "../../src/i18n/strings";
import type {
  AgentRuntimeProviderMetadata,
  AgentSettingsSnapshot,
  CodexAccountStatusResponse
} from "../../src/types/iliad";

describe("Codex account settings copy", () => {
  it("keeps the assistant provider routes explicit", () => {
    expect(appStrings.en.assistant.codex.connectedCopy).toBe("Chat uses Codex.");
    expect(appStrings.en.assistant.codex.dictationUsesApiKey).toBe("Dictation uses the OpenAI API.");
    expect(appStrings.en.assistant.codex.disconnectedCopy).toBe(
      "Connect Codex or use an OpenAI API key for chat."
    );
    expect(appStrings.en.assistant.codex.title).toBe("Codex");
    expect(appStrings.en.assistant.codex.role).toBe("ChatGPT plan.");
    expect(appStrings.en.assistant.apiKeyRole).toBe("Chat, editing, and dictation.");
    expect(appStrings.en.assistant.apiKeyActive).toBe("Active");
    expect(appStrings.es.assistant.codex.disconnectedCopy).toBe(
      "Conecta Codex o usa una clave API de OpenAI para el chat."
    );
    expect(appStrings.es.assistant.codex.role).toBe("Plan de ChatGPT.");
    expect(appStrings.es.assistant.apiKeyRole).toBe("Chat, edición y dictado.");
    expect(appStrings.es.assistant.apiKeyActive).toBe("Activa");
  });

  it("does not imply ChatGPT subscriptions power the current API-backed chat", () => {
    const codexCopy = [
      appStrings.en.assistant.codex.futureRuntime,
      appStrings.en.assistant.codex.currentChatUsesApiKey,
      appStrings.en.assistant.codex.connectedCopy,
      appStrings.en.assistant.codex.disconnectedCopy,
      appStrings.en.assistant.codex.unavailableCopy,
      appStrings.es.assistant.codex.futureRuntime,
      appStrings.es.assistant.codex.currentChatUsesApiKey,
      appStrings.es.assistant.codex.connectedCopy,
      appStrings.es.assistant.codex.disconnectedCopy,
      appStrings.es.assistant.codex.unavailableCopy
    ]
      .join(" ")
      .toLowerCase();

    expect(codexCopy).not.toContain("chatgpt pays for api");
    expect(codexCopy).not.toContain("included api usage");
    expect(codexCopy).not.toContain("no api key needed");
  });

  it("allows chat when either an API key or connected Codex account is available", () => {
    expect(canSendChat({ hasOpenAiApiKey: false }, null)).toBe(false);
    expect(canSendChat({ hasOpenAiApiKey: true }, null)).toBe(true);
    expect(
      canSendChat(
        { hasOpenAiApiKey: false },
        { available: true, connected: true, requiresOpenaiAuth: true, pendingLogin: false }
      )
    ).toBe(true);
  });

  it("keeps device login copy compact and localized", () => {
    expect(appStrings.en.assistant.codex.copyCode).toBe("Copy code");
    expect(appStrings.es.assistant.codex.copyCode).toBe("Copiar código");
    expect(appStrings.es.assistant.codex.deviceAuthorizationHelp).toBe(
      "Si OpenAI lo solicita, activa la autorización por código de dispositivo en la configuración de seguridad de ChatGPT."
    );
  });

  it("renders the pending device code as its own copyable value", () => {
    const onCodexAction = async () => undefined;
    const codex: CodexConnectionState = {
      busy: false,
      error: null,
      login: {
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-EFGH"
      },
      status: {
        available: true,
        connected: false,
        requiresOpenaiAuth: true,
        pendingLogin: true
      },
      onCancelLogin: onCodexAction,
      onConnect: onCodexAction,
      onDisconnect: onCodexAction,
      onOpenLogin: onCodexAction,
      onRefresh: onCodexAction
    };

    const html = renderToStaticMarkup(
      createElement(AssistantSettings, {
        apiKeyDraft: "",
        codex,
        labels: appStrings.es.assistant,
        mode: "balanced",
        modelDraft: "gpt-5.5",
        remote: remoteConnection(),
        settings: null,
        onApiKeyDraftChange: () => undefined,
        onModeChange: () => undefined,
        onModelDraftChange: () => undefined,
        onSave: () => undefined
      })
    );

    expect(html).toContain("<code>ABCD-EFGH</code>");
    expect(html).toContain("Copiar código");
    expect(html).toContain(appStrings.es.assistant.codex.deviceAuthorizationHelp);
    expect(html).not.toContain("Código: ABCD-EFGH");
    expect(html).not.toContain("Code: ABCD-EFGH");
  });

  it("renders connected Codex copy without rate-limit noise", () => {
    const onCodexAction = async () => undefined;
    const codex: CodexConnectionState = {
      busy: false,
      error: null,
      login: null,
      status: {
        available: true,
        connected: true,
        requiresOpenaiAuth: true,
        pendingLogin: false,
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 42,
            windowDurationMins: 300
          }
        }
      },
      onCancelLogin: onCodexAction,
      onConnect: onCodexAction,
      onDisconnect: onCodexAction,
      onOpenLogin: onCodexAction,
      onRefresh: onCodexAction
    };

    const html = renderToStaticMarkup(
      createElement(AssistantSettings, {
        apiKeyDraft: "",
        codex,
        labels: appStrings.en.assistant,
        mode: "balanced",
        modelDraft: "gpt-5.5",
        remote: remoteConnection(),
        settings: null,
        onApiKeyDraftChange: () => undefined,
        onModeChange: () => undefined,
        onModelDraftChange: () => undefined,
        onSave: () => undefined
      })
    );

    expect(html).toContain("ChatGPT plan.");
    expect(html).toContain("Chat, editing, and dictation.");
    expect(html).not.toContain("42% used");
  });

  it("marks the OpenAI API key active only when Codex is not connected", () => {
    const disconnected = renderSettings(remoteConnection(), {
      codexStatus: {
        available: false,
        connected: false,
        requiresOpenaiAuth: true,
        pendingLogin: false,
        error: {
          code: "app_server_unavailable",
          message: "Codex app-server is not running."
        }
      },
      settings: {
        hasOpenAiApiKey: true,
        model: "gpt-5.5",
        mode: "balanced",
        runtimeProvider: openAiRuntimeProvider()
      }
    });

    expect(disconnected).toContain("Unavailable");
    expect(disconnected).toContain("Codex CLI not found.");
    expect(disconnected).toContain("Active");
    expect(disconnected).toContain("Change key");
    expect(disconnected).not.toContain('placeholder="sk-..."');

    const connected = renderSettings(remoteConnection(), {
      settings: {
        hasOpenAiApiKey: true,
        model: "gpt-5.5",
        mode: "balanced",
        runtimeProvider: openAiRuntimeProvider()
      }
    });

    expect(connected).toContain("Connected");
    expect(connected).toContain("Saved");
    expect(connected).not.toContain("Active");
  });

  it("renders a constrained Codex-compatible agent model selector", () => {
    const onCodexAction = async () => undefined;
    const codex: CodexConnectionState = {
      busy: false,
      error: null,
      login: null,
      status: {
        available: true,
        connected: true,
        requiresOpenaiAuth: true,
        pendingLogin: false
      },
      onCancelLogin: onCodexAction,
      onConnect: onCodexAction,
      onDisconnect: onCodexAction,
      onOpenLogin: onCodexAction,
      onRefresh: onCodexAction
    };

    const html = renderToStaticMarkup(
      createElement(AssistantSettings, {
        apiKeyDraft: "",
        codex,
        labels: appStrings.en.assistant,
        mode: "balanced",
        modelDraft: "gpt-5.5",
        remote: remoteConnection(),
        settings: null,
        onApiKeyDraftChange: () => undefined,
        onModeChange: () => undefined,
        onModelDraftChange: () => undefined,
        onSave: () => undefined
      })
    );

    expect(html).toContain(">Model</h3>");
    expect(html).toContain("Codex-compatible models. gpt-5.5 is recommended.");
    for (const option of agentModelOptions) {
      expect(html).toContain(`value="${option.id}"`);
    }
    expect(html).not.toContain("gpt-5-mini");
    expect(html).not.toContain("OpenAI model");
  });

  it("keeps connection, remote access, and model settings in the reviewed order", () => {
    const html = renderSettings(remoteConnection());
    const connectionIndex = html.indexOf(">Connection</h3>");
    const codexIndex = html.indexOf("Codex");
    const apiKeyIndex = html.indexOf("OpenAI API key");
    const modelIndex = html.indexOf(">Model</h3>");
    const modeIndex = html.indexOf(">Mode</h3>");
    const remoteSectionIndex = html.indexOf(">Remote access</h3>");
    const telegramIndex = html.indexOf("Telegram");

    expect(connectionIndex).toBeGreaterThanOrEqual(0);
    expect(codexIndex).toBeGreaterThan(connectionIndex);
    expect(apiKeyIndex).toBeGreaterThan(codexIndex);
    expect(modelIndex).toBeGreaterThan(apiKeyIndex);
    expect(modeIndex).toBeGreaterThan(modelIndex);
    expect(remoteSectionIndex).toBeGreaterThan(modeIndex);
    expect(telegramIndex).toBeGreaterThan(remoteSectionIndex);
  });

  it("renders Telegram Remote Chat disabled copy and enable action", () => {
    const html = renderSettings(remoteConnection());

    expect(html).toContain("Telegram");
    expect(html).toContain("Disabled");
    expect(html).toContain("Ask from Telegram.");
    expect(html).not.toContain("Unpaired");
    expect(html).not.toContain("Iliad chat: Default remote chat");
    expect(html).not.toContain(appStrings.en.assistant.remote.privacyCopy);
    expect(html).not.toContain(appStrings.en.assistant.remote.readOnlyCopy);
    expect(html).toContain(">Enable</button>");
    expect(html).not.toContain(">Disable</button>");
    expect(html).not.toContain(">Revoke</button>");
    expect(html).not.toContain(">Use this chat</button>");
  });

  it("renders Telegram Remote Chat paired account and revoke action", () => {
    const html = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: {
            chatId: "chat-1",
            username: "sebastian",
            displayName: "Sebastian",
            pairedAt: "2026-05-27T12:00:00.000Z"
          },
          boundWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        }
      })
    );

    expect(html).toContain("Paired");
    expect(html).toContain("Paired with Sebastian");
    expect(html).toContain(">Disable</button>");
    expect(html).toContain(">Revoke</button>");
  });

  it("renders selected Telegram Remote Chat conversation copy and action eligibility", () => {
    const defaultHtml = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        },
        activeChatLabel: appStrings.en.assistant.remote.defaultRemoteChat,
        canUseCurrentChat: true
      })
    );
    expect(defaultHtml).toContain("Iliad chat: Default remote chat");
    expect(defaultHtml).toContain(">Use this chat</button>");

    const currentHtml = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          activeThreadId: "thread-current",
          activeThreadWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        },
        activeChatLabel: "This chat",
        canUseCurrentChat: false
      })
    );
    expect(currentHtml).toContain("Iliad chat: This chat");
    expect(currentHtml).not.toContain(">Use this chat</button>");

    const knownHtml = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          activeThreadId: "thread-known",
          activeThreadWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        },
        activeChatLabel: "Workshop notes",
        canUseCurrentChat: true
      })
    );
    expect(knownHtml).toContain("Iliad chat: Workshop notes");
    expect(knownHtml).toContain(">Use this chat</button>");

    const unknownHtml = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          activeThreadId: "thread-unknown",
          activeThreadWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        },
        activeChatLabel: appStrings.en.assistant.remote.selectedChat,
        canUseCurrentChat: true
      })
    );
    expect(unknownHtml).toContain("Iliad chat: Selected chat");
    expect(unknownHtml).toContain(">Use this chat</button>");
  });

  it("hides Use this chat when remote is disabled, blank, or already selected", () => {
    expect(renderSettings(remoteConnection({ activeChatLabel: "Default remote chat", canUseCurrentChat: false }))).not.toContain(
      ">Use this chat</button>"
    );
    expect(
      renderSettings(
        remoteConnection({
          settings: {
            enabled: true,
            relayDeviceId: "device-1",
            pairedChat: null,
            boundWorkspaceRoot: "/workspace",
            updatedAt: "2026-05-27T12:00:00.000Z"
          },
          activeChatLabel: "Default remote chat",
          canUseCurrentChat: false
        })
      )
    ).not.toContain(">Use this chat</button>");
    expect(
      renderSettings(
        remoteConnection({
          settings: {
            enabled: true,
            relayDeviceId: "device-1",
            pairedChat: null,
            boundWorkspaceRoot: "/workspace",
            activeThreadId: "thread-current",
            activeThreadWorkspaceRoot: "/workspace",
            updatedAt: "2026-05-27T12:00:00.000Z"
          },
          activeChatLabel: "This chat",
          canUseCurrentChat: false
        })
      )
    ).not.toContain(">Use this chat</button>");
  });

  it("renders Telegram Remote Chat pair action when enabled and unpaired", () => {
    const html = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        }
      })
    );

    expect(html).toContain("Enabled");
    expect(html).toContain("Unpaired");
    expect(html).toContain(">Disable</button>");
    expect(html).toContain(">Pair</button>");
    expect(html).not.toContain(">Revoke</button>");
  });

  it("renders Telegram Remote Chat pairing link and expiry after pairing starts", () => {
    const fullPairingUrl = "https://t.me/iliad_bot?start=pair-token-secret";
    const html = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        },
        pairing: {
          token: "pair-token-secret",
          pairingSessionId: "pair-session",
          expiresAt: "2026-05-27T12:10:00.000Z",
          pairingUrl: fullPairingUrl
        }
      })
    );

    expect(html).toContain("Pairing link");
    expect(html).toContain('class="assistant-remote-pairing-row"');
    expect(html).toContain('class="assistant-remote-pairing-value">t.me/iliad_bot...</code>');
    expect(html).toContain('aria-label="Copy link"');
    expect(html).toContain('data-tooltip="Copy link"');
    expect(html).toContain('aria-label="Open link"');
    expect(html).toContain('data-tooltip="Open link"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Expires");
    expect(html).not.toContain(">Copy link</button>");
    expect(html).not.toContain(">Open link</button>");
    expectNoSecretMarkup(html, [fullPairingUrl, "pair-token-secret"]);
    expect(html).not.toContain("title=");
    expect(html).not.toContain("secret");
  });

  it("renders token-only Telegram pairing as copy-only without exposing the token", () => {
    const html = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        },
        pairing: {
          token: "token-only-secret",
          pairingSessionId: "pair-session",
          expiresAt: "2026-05-27T12:10:00.000Z"
        }
      })
    );

    expect(html).toContain("Pairing code");
    expect(html).toContain('class="assistant-remote-pairing-value">********</code>');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('data-tooltip="Copy code"');
    expect(html).not.toContain('aria-label="Open link"');
    expectNoSecretMarkup(html, ["token-only-secret"]);
  });

  it("keeps invalid and non-Telegram pairing URLs copy-only", () => {
    expect(getValidTelegramPairingUrl("https://t.me/iliad_bot?start=pair-token-secret")).toBe(
      "https://t.me/iliad_bot?start=pair-token-secret"
    );
    expect(getValidTelegramPairingUrl("http://t.me/iliad_bot?start=pair-token-secret")).toBe(null);
    expect(getValidTelegramPairingUrl("https://telegram.example/iliad_bot?start=pair-token-secret")).toBe(null);
    expect(getValidTelegramPairingUrl("pair-token-secret")).toBe(null);
    expect(getRemotePairingDisplayValue("https://t.me/iliad_bot?start=pair-token-secret", "pair-token-secret")).toBe(
      "t.me/iliad_bot..."
    );
    expect(getRemotePairingDisplayValue(undefined, "pair-token-secret")).toBe("********");

    const html = renderSettings(
      remoteConnection({
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        },
        pairing: {
          token: "pair-token-secret",
          pairingSessionId: "pair-session",
          expiresAt: "2026-05-27T12:10:00.000Z",
          pairingUrl: "https://telegram.example/iliad_bot?start=pair-token-secret"
        }
      })
    );

    expect(html).toContain('aria-label="Copy link"');
    expect(html).not.toContain('aria-label="Open link"');
    expectNoSecretMarkup(html, ["https://telegram.example/iliad_bot?start=pair-token-secret", "pair-token-secret"]);
  });

  it("renders concise Telegram relay setup errors", () => {
    const html = renderSettings(
      remoteConnection({
        error: appStrings.en.assistant.remote.setupRequired,
        settings: {
          enabled: true,
          relayDeviceId: "device-1",
          pairedChat: null,
          boundWorkspaceRoot: "/workspace",
          updatedAt: "2026-05-27T12:00:00.000Z"
        }
      })
    );

    expect(html).toContain("Set up a Telegram relay URL before pairing.");
    expect(html).not.toContain(appStrings.en.assistant.remote.errorFallback);
  });
});

function renderSettings(
  remote: TelegramRemoteConnectionState,
  overrides: {
    codexStatus?: CodexAccountStatusResponse;
    settings?: AgentSettingsSnapshot | null;
  } = {}
) {
  const onCodexAction = async () => undefined;
  const codex: CodexConnectionState = {
    busy: false,
    error: null,
    login: null,
    status: overrides.codexStatus ?? {
      available: true,
      connected: true,
      requiresOpenaiAuth: true,
      pendingLogin: false
    },
    onCancelLogin: onCodexAction,
    onConnect: onCodexAction,
    onDisconnect: onCodexAction,
    onOpenLogin: onCodexAction,
    onRefresh: onCodexAction
  };

  return renderToStaticMarkup(
    createElement(AssistantSettings, {
      apiKeyDraft: "",
      codex,
      labels: appStrings.en.assistant,
      mode: "balanced",
      modelDraft: "gpt-5.5",
      remote,
      settings: overrides.settings ?? null,
      onApiKeyDraftChange: () => undefined,
      onModeChange: () => undefined,
      onModelDraftChange: () => undefined,
      onSave: () => undefined
    })
  );
}

function openAiRuntimeProvider(): AgentRuntimeProviderMetadata {
  return {
    id: "openai-api",
    label: "OpenAI API",
    billing: "openai_platform_api",
    capabilities: {
      text: true,
      thinkingSummaries: true,
      reviewableProposals: true,
      workspaceEvents: false,
      managedAccountAuth: false,
      rateLimits: false,
      media: {
        transcription: true,
        images: false,
        realtime: false
      }
    }
  };
}

function remoteConnection(
  overrides: Partial<TelegramRemoteConnectionState> = {}
): TelegramRemoteConnectionState {
  const onRemoteAction = async () => undefined;

  return {
    activeChatLabel: appStrings.en.assistant.remote.defaultRemoteChat,
    busy: false,
    canUseCurrentChat: false,
    error: null,
    pairing: null,
    settings: {
      enabled: false,
      relayDeviceId: "",
      pairedChat: null,
      updatedAt: ""
    },
    onDisable: onRemoteAction,
    onEnable: onRemoteAction,
    onPair: onRemoteAction,
    onRevoke: onRemoteAction,
    onUseCurrentChat: onRemoteAction,
    ...overrides
  };
}

function expectNoSecretMarkup(html: string, values: string[]) {
  for (const value of values) {
    expect(html).not.toContain(value);
  }
}
