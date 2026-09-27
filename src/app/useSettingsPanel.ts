import { useCallback, useEffect, useRef, useState } from "react";
import { settingsOpenerAttribute } from "../components/settings/SettingsPanel";
import { readSettingsTab, writeSettingsTab, type SettingsTab } from "../preferences/settingsTab";

interface CloseOptions {
  /** Return focus to what had it when Settings opened (Escape, the row, the menu). */
  restoreFocus?: boolean;
}

/**
 * The Settings panel's state (premium pass stage 4): open/closed, the tab
 * (remembered in localStorage), the key-field request from AI notices, focus
 * return to the opener, and outside-click closing.
 */
export function useSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(() => readSettingsTab());
  // Non-zero while a notice asked for the key field; cleared when the Writing body goes away.
  const [keyFieldFocusRequest, setKeyFieldFocusRequest] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  openRef.current = open;

  const selectTab = useCallback((next: SettingsTab) => {
    setTab(next);
    writeSettingsTab(next);

    if (next !== "writing") {
      setKeyFieldFocusRequest(0);
    }
  }, []);

  const openSettings = useCallback(
    (nextTab?: SettingsTab) => {
      if (!openRef.current) {
        const active = document.activeElement;
        openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
        openRef.current = true;
        setOpen(true);
      }

      if (nextTab) {
        selectTab(nextTab);
      }
    },
    [selectTab]
  );

  const closeSettings = useCallback(({ restoreFocus = true }: CloseOptions = {}) => {
    if (!openRef.current) {
      return;
    }

    openRef.current = false;
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
    setKeyFieldFocusRequest(0);
  }, []);

  const toggleSettings = useCallback(() => {
    if (openRef.current) {
      closeSettings();
    } else {
      openSettings();
    }
  }, [closeSettings, openSettings]);

  /** A notice's "Use my key" / "Update key": Settings on the Writing tab with the key field focused. */
  const requestKeyField = useCallback(() => {
    openSettings("writing");
    setKeyFieldFocusRequest((request) => request + 1);
  }, [openSettings]);

  // Focus goes back to the opener once the panel is gone (unless the close
  // came from a click elsewhere, which moves focus itself).
  useEffect(() => {
    if (open) {
      return;
    }

    const opener = openerRef.current;
    const restore = restoreFocusRef.current;
    openerRef.current = null;
    restoreFocusRef.current = false;

    if (!restore || !opener?.isConnected) {
      return;
    }

    const active = document.activeElement;

    if (!active || active === document.body) {
      opener.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node) || panelRef.current?.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest(`[${settingsOpenerAttribute}]`)) {
        return;
      }

      closeSettings({ restoreFocus: false });
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [closeSettings, open]);

  return {
    settingsOpen: open,
    settingsTab: tab,
    settingsPanelRef: panelRef,
    keyFieldFocusRequest,
    openSettings,
    closeSettings,
    toggleSettings,
    selectSettingsTab: selectTab,
    requestKeyField
  };
}
