import { ArrowLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface AssistantPanelViewProps {
  title: string;
  backLabel: string;
  onBack: () => void;
  /** Optional trailing control in the header (e.g. Clear history). */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Full-body panel view (History, Settings). Renders in the chat's grid slot so the
 * panel header and its controls stay put while the chat body is replaced. Provides a
 * shared back header + scroll body and Esc-to-close so every overlay opens the same way.
 */
export function AssistantPanelView({ title, backLabel, onBack, actions, children }: AssistantPanelViewProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onBack();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  return (
    <section className="assistant-view" aria-label={title}>
      <header className="assistant-view-header">
        <button
          type="button"
          className="icon-button"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <span>{title}</span>
        {actions ?? null}
      </header>
      <div className="assistant-view-body">{children}</div>
    </section>
  );
}
