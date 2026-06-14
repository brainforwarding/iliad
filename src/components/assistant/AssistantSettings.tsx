import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { agentModelOptions } from "../../assistant/agentModels";
import {
  modeOptions,
  type CodexConnectionState,
  type TelegramRemoteConnectionState
} from "../../assistant/useAssistantRun";
import type { AppStrings } from "../../i18n/strings";
import type { AgentMode, AgentSettingsSnapshot, RemotePairedTelegramChat } from "../../types/iliad";

interface AssistantSettingsProps {
  apiKeyDraft: string;
  codex: CodexConnectionState;
  labels: AppStrings["assistant"];
  mode: AgentMode;
  modelDraft: string;
  remote: TelegramRemoteConnectionState;
  settings: AgentSettingsSnapshot | null;
  onApiKeyDraftChange: (value: string) => void;
  onModeChange: (value: AgentMode) => void;
  onModelDraftChange: (value: string) => void;
  onSave: () => void;
}

export function AssistantSettings({
  apiKeyDraft,
  codex,
  labels,
  mode,
  modelDraft,
  remote,
  settings,
  onApiKeyDraftChange,
  onModeChange,
  onModelDraftChange,
  onSave
}: AssistantSettingsProps) {
  const hasSavedKey = Boolean(settings?.hasOpenAiApiKey);
  const [editingKey, setEditingKey] = useState(false);

  const openApiKeys = () => {
    void window.iliad.openUrl("https://platform.openai.com/api-keys");
  };
  const copyCodexUserCode = () => {
    if (!codex.login) {
      return;
    }

    void navigator.clipboard.writeText(codex.login.userCode);
  };
  const copyRemotePairingValue = () => {
    if (!remote.pairing) {
      return;
    }

    void navigator.clipboard.writeText(remote.pairing.pairingUrl ?? remote.pairing.token);
  };
  const openRemotePairingUrl = () => {
    if (!remote.pairing?.pairingUrl) {
      return;
    }

    const pairingUrl = getValidTelegramPairingUrl(remote.pairing.pairingUrl);
    if (!pairingUrl) {
      return;
    }

    void window.iliad.openUrl(pairingUrl);
  };

  const status = codex.status;
  const connected = Boolean(status?.available && status.connected);
  const connecting = Boolean(codex.login || status?.pendingLogin);
  const unavailable = Boolean(status && !status.available);
  const notConnected = !connected && !connecting && !unavailable;
  const statusLabel = connected
    ? labels.codex.connected
    : connecting
      ? labels.codex.connecting
      : unavailable
        ? labels.codex.unavailable
        : status
          ? labels.codex.notConnected
          : labels.codex.checking;
  const dotState = connected ? "on" : connecting ? "pending" : "off";
  const accountLine = connected
    ? status?.account?.email
      ? labels.codex.signedInAs(status.account.email)
      : status?.account?.planType
        ? labels.codex.plan(status.account.planType)
        : labels.codex.connected
    : null;
  const codexUnavailableCopy =
    status?.error?.code === "app_server_unavailable" ? labels.codex.cliNotFound : labels.codex.unavailableCopy;
  const apiKeyStatusLabel = hasSavedKey ? (connected ? labels.apiKeySaved : labels.apiKeyActive) : "";
  const showApiKeyInput = !hasSavedKey || editingKey;
  const remoteSettings = remote.settings;
  const remoteEnabled = Boolean(remoteSettings?.enabled);
  const remotePairedChat = remoteSettings?.pairedChat ?? null;
  const remotePairing = remoteEnabled && !remotePairedChat ? remote.pairing : null;
  const remoteStatusLabel = remoteSettings
    ? remoteEnabled
      ? remotePairedChat
        ? labels.remote.paired
        : labels.remote.enabled
      : labels.remote.disabled
    : labels.remote.checking;
  const remoteDotState = remoteEnabled ? (remotePairedChat ? "on" : "pending") : "off";
  const showRemoteDetails = Boolean(remoteSettings && remoteEnabled);
  const validRemotePairingUrl = getValidTelegramPairingUrl(remotePairing?.pairingUrl);

  return (
    <div className="assistant-settings">
      <section className="assistant-settings-group">
        <h3 className="assistant-settings-section">{labels.connection}</h3>

        {/* Codex route */}
        <div className="assistant-conn-card">
          <div className="assistant-conn-top">
            <span className="assistant-conn-name">{labels.codex.title}</span>
            <span className="assistant-conn-status">
              <i className={`assistant-conn-dot is-${dotState}`} aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
          <span className="assistant-conn-role">{labels.codex.role}</span>
          {accountLine ? <span className="assistant-conn-meta">{accountLine}</span> : null}

          {connecting && codex.login ? (
            <div className="assistant-codex-login">
              <span>{labels.codex.deviceUrl}</span>
              <div className="assistant-codex-code-row">
                <code>{codex.login.userCode}</code>
                <button type="button" disabled={codex.busy} onClick={copyCodexUserCode}>
                  {labels.codex.copyCode}
                </button>
              </div>
              <small>{labels.codex.deviceAuthorizationHelp}</small>
            </div>
          ) : null}

          {unavailable ? <span className="assistant-conn-meta">{codexUnavailableCopy}</span> : null}
          {codex.error ? <span className="assistant-codex-error">{labels.codex.errorFallback}</span> : null}

          <div className="assistant-conn-actions">
            {notConnected ? (
              <button type="button" disabled={codex.busy} onClick={() => void codex.onConnect()}>
                {labels.codex.connect}
              </button>
            ) : null}
            {connecting ? (
              <>
                <button type="button" disabled={codex.busy} onClick={() => void codex.onOpenLogin()}>
                  {labels.codex.openOpenAI}
                </button>
                <button type="button" disabled={codex.busy} onClick={() => void codex.onCancelLogin()}>
                  {labels.codex.cancel}
                </button>
              </>
            ) : null}
            {connected ? (
              <>
                <button type="button" disabled={codex.busy} onClick={() => void codex.onRefresh()}>
                  {labels.codex.refresh}
                </button>
                <button type="button" disabled={codex.busy} onClick={() => void codex.onDisconnect()}>
                  {labels.codex.disconnect}
                </button>
              </>
            ) : null}
            {unavailable ? (
              <button type="button" disabled={codex.busy} onClick={() => void codex.onRefresh()}>
                {labels.codex.refresh}
              </button>
            ) : null}
          </div>
        </div>

        {/* OpenAI API key route */}
        <div className="assistant-conn-card">
          <div className="assistant-conn-top">
            <span className="assistant-conn-name">{labels.apiKey}</span>
            {apiKeyStatusLabel ? (
              <span className="assistant-conn-status">
                <i className="assistant-conn-dot is-on" aria-hidden="true" />
                {apiKeyStatusLabel}
              </span>
            ) : null}
          </div>
          <span className="assistant-conn-role">{labels.apiKeyRole}</span>

          {showApiKeyInput ? (
            <input
              value={apiKeyDraft}
              type="password"
              placeholder={hasSavedKey ? labels.apiKeySaved : labels.apiKeyPlaceholder}
              onChange={(event) => onApiKeyDraftChange(event.target.value)}
            />
          ) : null}

          <div className="assistant-conn-actions">
            {hasSavedKey && !editingKey ? (
              <button type="button" onClick={() => setEditingKey(true)}>
                {labels.changeKey}
              </button>
            ) : null}
            <button type="button" onClick={openApiKeys}>
              {labels.getApiKey}
            </button>
          </div>
        </div>
      </section>

      <section className="assistant-settings-group">
        <h3 className="assistant-settings-section">{labels.modelSection}</h3>
        <select value={modelDraft} onChange={(event) => onModelDraftChange(event.target.value)}>
          {agentModelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <small className="assistant-settings-note">{labels.modelHelper}</small>
      </section>

      <section className="assistant-settings-group">
        <h3 className="assistant-settings-section">{labels.mode}</h3>
        <div className="assistant-mode-row" role="group" aria-label={labels.mode}>
          {modeOptions(labels).map((option) => (
            <button
              key={option.value}
              type="button"
              className={mode === option.value ? "is-active" : ""}
              onClick={() => onModeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="assistant-settings-group">
        <h3 className="assistant-settings-section">{labels.remote.section}</h3>

        {/* Telegram Remote Chat - read-only remote access */}
        <div className="assistant-conn-card">
          <div className="assistant-conn-top">
            <span className="assistant-conn-name">{labels.remote.title}</span>
            <span className="assistant-conn-status">
              <i className={`assistant-conn-dot is-${remoteDotState}`} aria-hidden="true" />
              {remoteStatusLabel}
            </span>
          </div>
          <span className="assistant-conn-role">{labels.remote.role}</span>
          {showRemoteDetails ? (
            <span className="assistant-conn-meta">
              {remotePairedChat ? labels.remote.paired : labels.remote.unpaired}
            </span>
          ) : null}
          {showRemoteDetails && remotePairedChat ? (
            <>
              <span className="assistant-conn-meta">{labels.remote.pairedWith(telegramChatLabel(remotePairedChat))}</span>
              <span className="assistant-conn-meta">{labels.remote.pairedAt(formatRemotePairedAt(remotePairedChat.pairedAt))}</span>
            </>
          ) : null}
          {showRemoteDetails ? (
            <div className="assistant-remote-thread-row">
              <span className="assistant-conn-meta">{labels.remote.iliadChat(remote.activeChatLabel)}</span>
              {remote.canUseCurrentChat ? (
                <button type="button" disabled={remote.busy} onClick={() => void remote.onUseCurrentChat()}>
                  {labels.remote.useThisChat}
                </button>
              ) : null}
            </div>
          ) : null}
          {showRemoteDetails ? (
            <>
              <span className="assistant-conn-meta">{labels.remote.readOnlyCopy}</span>
              <span className="assistant-conn-meta">{labels.remote.privacyCopy}</span>
            </>
          ) : null}
          {remotePairing ? (
            <div className="assistant-remote-pairing">
              <span>{remotePairing.pairingUrl ? labels.remote.pairingLink : labels.remote.pairingCode}</span>
              <div className="assistant-remote-pairing-row">
                <code className="assistant-remote-pairing-value">
                  {getRemotePairingDisplayValue(remotePairing.pairingUrl, remotePairing.token)}
                </code>
                <button
                  type="button"
                  className="assistant-remote-pairing-action"
                  disabled={remote.busy}
                  aria-label={remotePairing.pairingUrl ? labels.remote.copyLink : labels.remote.copyCode}
                  data-tooltip={remotePairing.pairingUrl ? labels.remote.copyLink : labels.remote.copyCode}
                  onClick={copyRemotePairingValue}
                >
                  <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
                {validRemotePairingUrl ? (
                  <button
                    type="button"
                    className="assistant-remote-pairing-action"
                    disabled={remote.busy}
                    aria-label={labels.remote.openLink}
                    data-tooltip={labels.remote.openLink}
                    onClick={openRemotePairingUrl}
                  >
                    <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <small>{labels.remote.expiresAt(formatRemotePairingExpiry(remotePairing.expiresAt))}</small>
            </div>
          ) : null}
          {remote.error ? <span className="assistant-codex-error">{remote.error}</span> : null}

          <div className="assistant-conn-actions">
            {remoteSettings && !remoteEnabled ? (
              <button type="button" disabled={remote.busy} onClick={() => void remote.onEnable()}>
                {labels.remote.enable}
              </button>
            ) : null}
            {remoteSettings && remoteEnabled ? (
              <button type="button" disabled={remote.busy} onClick={() => void remote.onDisable()}>
                {labels.remote.disable}
              </button>
            ) : null}
            {remoteSettings && remoteEnabled && !remotePairedChat ? (
              <button type="button" disabled={remote.busy} onClick={() => void remote.onPair()}>
                {labels.remote.pair}
              </button>
            ) : null}
            {remotePairedChat ? (
              <button type="button" disabled={remote.busy} onClick={() => void remote.onRevoke()}>
                {labels.remote.revoke}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="assistant-settings-save">
        <button type="button" className="assistant-apply-button" onClick={onSave}>
          <Check size={14} />
          {labels.saveSettings}
        </button>
      </div>
    </div>
  );
}

function telegramChatLabel(chat: RemotePairedTelegramChat) {
  if (chat.displayName?.trim()) {
    return chat.displayName.trim();
  }

  if (chat.username?.trim()) {
    return `@${chat.username.trim().replace(/^@/, "")}`;
  }

  return chat.chatId;
}

function formatRemotePairedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatRemotePairingExpiry(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function getValidTelegramPairingUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.hostname !== "t.me") {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

export function getRemotePairingDisplayValue(pairingUrl: string | undefined, token: string) {
  const telegramUrl = getValidTelegramPairingUrl(pairingUrl);

  if (!telegramUrl) {
    return token ? "********" : "****";
  }

  const url = new URL(telegramUrl);
  const compactPath = url.pathname === "/" ? "" : url.pathname;
  const hasHiddenParts = Boolean(url.search || url.hash);

  return `${url.hostname}${compactPath}${hasHiddenParts ? "..." : ""}`;
}
