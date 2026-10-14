import { useCallback, useEffect, useState } from "react";

export const commentMarginStorageKey = "iliad:comment-margin";

/** Whether comments show in the right margin (a display preference; default off). */
export function readCommentMarginVisible(): boolean {
  try {
    return localStorage.getItem(commentMarginStorageKey) === "shown";
  } catch {
    return false;
  }
}

export function writeCommentMarginVisible(visible: boolean) {
  try {
    localStorage.setItem(commentMarginStorageKey, visible ? "shown" : "hidden");
  } catch {
    // Storage can be unavailable; the margin then starts hidden next time.
  }
}

export function useCommentMarginPreference() {
  const [visible, setVisible] = useState(readCommentMarginVisible);

  useEffect(() => {
    writeCommentMarginVisible(visible);
  }, [visible]);

  const toggle = useCallback(() => setVisible((current) => !current), []);

  return { visible, toggle };
}
