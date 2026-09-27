import { ArrowDown, Settings } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AppLanguage } from "../i18n/appLanguage";
import type { AppStrings } from "../i18n/strings";
import type { WhatsNewEntry } from "../whatsNew/entries";
import { Icon } from "./Icon";

interface WhatsNewCardProps {
  entry: WhatsNewEntry;
  language: AppLanguage;
  labels: AppStrings["whatsNew"];
  /** For the illustration: the footer's own words in this language. */
  illustrationLabels: { settings: string; update: string };
  onClose: () => void;
  onOpenReleaseNotes: () => void;
}

/**
 * The one-time "What's new" card after an update (spec 2026-09-27, Figma
 * frame 8): centred over a dimmed window. Got it or Esc closes it; Release
 * notes opens the GitHub release.
 */
export function WhatsNewCard({ entry, language, labels, illustrationLabels, onClose, onOpenReleaseNotes }: WhatsNewCardProps) {
  const gotItRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    gotItRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="whats-new-backdrop">
      <div className="whats-new-card" role="dialog" aria-modal="true" aria-label={labels.dialogLabel} aria-describedby="whats-new-body">
        {entry.illustration === "update-pill" ? (
          <div className="whats-new-illustration" aria-hidden="true">
            <div className="whats-new-footer-mock">
              <span className="whats-new-footer-settings">
                <Icon icon={Settings} size={12} />
                <span>{illustrationLabels.settings}</span>
              </span>
              <span className="whats-new-footer-pill">
                <Icon icon={ArrowDown} size={12} />
                <span>{illustrationLabels.update}</span>
              </span>
            </div>
          </div>
        ) : null}
        <div className="whats-new-copy">
          <h2>{entry.title[language]}</h2>
          <p id="whats-new-body">{entry.body[language]}</p>
        </div>
        <div className="whats-new-actions">
          <button type="button" className="whats-new-link" onClick={onOpenReleaseNotes}>
            {labels.releaseNotes}
          </button>
          <button type="button" ref={gotItRef} className="whats-new-primary" onClick={onClose}>
            {labels.gotIt}
          </button>
        </div>
      </div>
    </div>
  );
}
