import { Languages } from "lucide-react";
import type { RefObject } from "react";
import type { AppLanguage } from "../i18n/appLanguage";

interface LanguageMenuLabels {
  title: string;
  ariaLabel: string;
  english: string;
  spanish: string;
}

interface LanguageMenuProps {
  language: AppLanguage;
  labels: LanguageMenuLabels;
  menuRef: RefObject<HTMLDivElement>;
  onSetLanguage: (language: AppLanguage) => void;
  onToggleOpen: () => void;
  open: boolean;
}

export function LanguageMenu({
  language,
  labels,
  menuRef,
  onSetLanguage,
  onToggleOpen,
  open
}: LanguageMenuProps) {
  return (
    <div className="language-menu" ref={menuRef}>
      <button
        type="button"
        className="icon-button"
        data-tooltip={labels.title}
        aria-label={labels.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <Languages size={16} />
      </button>

      {open ? (
        <div className="language-popover" role="dialog" aria-label={labels.ariaLabel}>
          <button
            type="button"
            className={language === "en" ? "language-option is-active" : "language-option"}
            aria-pressed={language === "en"}
            onClick={() => onSetLanguage("en")}
          >
            {labels.english}
          </button>
          <button
            type="button"
            className={language === "es" ? "language-option is-active" : "language-option"}
            aria-pressed={language === "es"}
            onClick={() => onSetLanguage("es")}
          >
            {labels.spanish}
          </button>
        </div>
      ) : null}
    </div>
  );
}
