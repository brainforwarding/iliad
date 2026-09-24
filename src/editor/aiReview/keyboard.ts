/**
 * Tab accepts only the tighten inline review. Outside chunks never act from
 * the keyboard shortcut: Keep and Restore change the baseline or the disk, so
 * they need an explicit button press (spec V7).
 */
export function acceptReviewShortcutApplies({
  tightenReviewActive,
  outsideReviewActive
}: {
  tightenReviewActive: boolean;
  outsideReviewActive: boolean;
}) {
  return tightenReviewActive && !outsideReviewActive;
}

/** Index of the chunk whose Keep button takes focus after a chunk action. */
export function nextChunkFocusIndex(actedIndex: number, remainingCount: number) {
  if (remainingCount <= 0) {
    return null;
  }

  return Math.max(0, Math.min(actedIndex, remainingCount - 1));
}
