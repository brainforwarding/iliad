import { useEffect, useRef, useState } from "react";
import type { MenuCommand } from "../types/iliad";

/**
 * Window chrome state owned by main: whether this window is in full screen
 * (the top-row controls move to the far left, no traffic-light gap) and the
 * app-menu commands sent to this window (View → Toggle Sidebar, ⌃⌘S).
 */
export function useWindowChrome({ onMenuCommand }: { onMenuCommand: (command: MenuCommand) => void }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const onMenuCommandRef = useRef(onMenuCommand);
  onMenuCommandRef.current = onMenuCommand;

  useEffect(() => {
    const api = window.iliad?.window;

    if (!api) {
      return;
    }

    let disposed = false;
    // Subscribe first so a change during the initial query is not lost; the
    // event is newer than the query answer, so it wins.
    let sawEvent = false;
    const unsubscribeFullscreen = api.onFullscreenChanged((fullscreen) => {
      sawEvent = true;
      setIsFullscreen(fullscreen);
    });
    const unsubscribeMenu = api.onMenuCommand((command) => onMenuCommandRef.current(command));

    void api
      .isFullscreen()
      .then((fullscreen) => {
        if (!disposed && !sawEvent) {
          setIsFullscreen(fullscreen);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribeFullscreen();
      unsubscribeMenu();
    };
  }, []);

  return { isFullscreen };
}
