import { Clock3, KeyRound, MessageSquarePlus, Settings } from "lucide-react";
import type { AppStrings } from "../../i18n/strings";
import type { AgentSettingsSnapshot } from "../../types/iliad";

interface AssistantHeaderProps {
  activeThreadTitle: string;
  labels: AppStrings["assistant"];
  settings: AgentSettingsSnapshot | null;
  onNewChat: () => void;
  onToggleHistory: () => void;
  onToggleSettings: () => void;
}

export function AssistantHeader({
  activeThreadTitle,
  labels,
  settings,
  onNewChat,
  onToggleHistory,
  onToggleSettings
}: AssistantHeaderProps) {
  return (
    <header className="assistant-header">
      <div className="assistant-title-block">
        <span className="assistant-eyebrow">{labels.title}</span>
        {activeThreadTitle ? <span className="assistant-thread-title">{activeThreadTitle}</span> : null}
      </div>
      <div className="assistant-header-actions">
        <button type="button" className="icon-button" data-tooltip={labels.newChat} aria-label={labels.newChat} onClick={onNewChat}>
          <MessageSquarePlus size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          data-tooltip={labels.history.title}
          aria-label={labels.history.title}
          onClick={onToggleHistory}
        >
          <Clock3 size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          data-tooltip={labels.settings}
          aria-label={labels.settings}
          onClick={onToggleSettings}
        >
          {settings?.hasOpenAiApiKey ? <Settings size={16} /> : <KeyRound size={16} />}
        </button>
      </div>
    </header>
  );
}
