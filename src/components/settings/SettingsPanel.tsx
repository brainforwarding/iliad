import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { settingsTabForKey, settingsTabs, type SettingsTab } from "../../preferences/settingsTab";

/** Marks an element that toggles Settings (the sidebar row), so a press on it is not an outside click. */
export const settingsOpenerAttribute = "data-settings-opener";

interface SettingsPanelLabels {
  dialogLabel: string;
  tabsLabel: string;
  tabs: Record<SettingsTab, string>;
}

interface SettingsPanelProps {
  labels: SettingsPanelLabels;
  tab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
  panelRef?: RefObject<HTMLDivElement>;
  /** The active tab's body; only that tab is mounted. */
  children: ReactNode;
}

/**
 * Settings (premium pass, Figma H): a non-modal dialog anchored above the
 * sidebar's Settings row. The content scrolls above segmented tabs that stay
 * put at the bottom (General · Typography · Writing). Only the active body is
 * mounted, so leaving a tab ends whatever it was doing (e.g. shortcut recording).
 */
export function SettingsPanel({ labels, tab, onSelectTab, panelRef, children }: SettingsPanelProps) {
  const id = useId();
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const localPanelRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the dialog when it opens, unless a body already took it
  // (the Groq key field on a key request).
  useEffect(() => {
    const panel = localPanelRef.current;

    if (panel && !panel.contains(document.activeElement)) {
      tabRefs.current.get(tab)?.focus();
    }
    // Only on open: the panel mounts when Settings opens.
  }, []);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = settingsTabForKey(tab, event.key);

    if (!next) {
      return;
    }

    event.preventDefault();
    onSelectTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div
      ref={(element) => {
        localPanelRef.current = element;

        if (panelRef) {
          (panelRef as { current: HTMLDivElement | null }).current = element;
        }
      }}
      className="settings-panel"
      role="dialog"
      aria-modal="false"
      aria-label={labels.dialogLabel}
    >
      <div
        className="settings-content"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${tab}`}
      >
        {children}
      </div>
      <div className="settings-tabs" role="tablist" aria-label={labels.tabsLabel}>
        {settingsTabs.map((item) => {
          const selected = item === tab;

          return (
            <button
              key={item}
              ref={(element) => {
                if (element) {
                  tabRefs.current.set(item, element);
                } else {
                  tabRefs.current.delete(item);
                }
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${item}`}
              className={selected ? "settings-tab is-active" : "settings-tab"}
              aria-selected={selected}
              aria-controls={selected ? `${id}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectTab(item)}
              onKeyDown={onTabKeyDown}
            >
              {labels.tabs[item]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
