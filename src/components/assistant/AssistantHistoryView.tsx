import { compactChatThreadAge, chatHistoryGroup, type ChatHistoryGroupKey } from "../../assistant/chatHistory";
import type { AppStrings } from "../../i18n/strings";
import type { AgentChatThreadSummary } from "../../types/iliad";
import { AssistantPanelView } from "./AssistantPanelView";

interface AssistantHistoryViewProps {
  activeThreadId: string | null;
  disabled: boolean;
  labels: AppStrings["assistant"];
  loading: boolean;
  threads: AgentChatThreadSummary[];
  onBack: () => void;
  onClear: () => void;
  onSelect: (threadId: string) => void;
}

const groupOrder: ChatHistoryGroupKey[] = ["today", "yesterday", "thisWeek", "older"];

export function AssistantHistoryView({
  activeThreadId,
  disabled,
  labels,
  loading,
  threads,
  onBack,
  onClear,
  onSelect
}: AssistantHistoryViewProps) {
  const grouped = new Map<ChatHistoryGroupKey, AgentChatThreadSummary[]>();

  for (const thread of threads) {
    const group = chatHistoryGroup(thread.updatedAt);
    grouped.set(group, [...(grouped.get(group) ?? []), thread]);
  }

  return (
    <AssistantPanelView
      title={labels.history.title}
      backLabel={labels.history.back}
      onBack={onBack}
      actions={
        threads.length > 0 ? (
          <button type="button" className="assistant-history-clear" disabled={disabled} onClick={onClear}>
            {labels.history.clear}
          </button>
        ) : null
      }
    >
      {loading ? <div className="assistant-history-empty">{labels.history.loading}</div> : null}
      {!loading && threads.length === 0 ? (
        <div className="assistant-history-empty">{labels.history.empty}</div>
      ) : null}
      {!loading
        ? groupOrder.map((group) => {
            const groupThreads = grouped.get(group) ?? [];

            if (groupThreads.length === 0) {
              return null;
            }

            return (
              <section className="assistant-history-group" key={group}>
                <h3>{labels.history.groups[group]}</h3>
                {groupThreads.map((thread) => (
                  <button
                    type="button"
                    className={thread.id === activeThreadId ? "is-active" : undefined}
                    disabled={disabled}
                    key={thread.id}
                    onClick={() => onSelect(thread.id)}
                  >
                    <span>{thread.title}</span>
                    <time dateTime={thread.updatedAt}>{compactChatThreadAge(thread.updatedAt)}</time>
                  </button>
                ))}
              </section>
            );
          })
        : null}
    </AssistantPanelView>
  );
}
