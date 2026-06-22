function reviewDebugEnabled() {
  if (import.meta.env.DEV) {
    return true;
  }

  try {
    return window.localStorage.getItem("iliad.debug.reviewNavigation") === "1";
  } catch {
    return false;
  }
}

export function logReviewNavigation(event: string, details: Record<string, unknown> = {}) {
  if (!reviewDebugEnabled()) {
    return;
  }

  console.info(`[review-nav] ${event}`, details);
}
