/** Keep independent statistics requests usable when one provider query fails. */
export async function loadPostHogStat<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    // Preserve known failure categories without logging provider payloads, credentials or PII.
    const message = error instanceof Error && (
      error.message === "PostHog statistics are not configured" ||
      error.message === "Invalid statistics branch scope"
    ) ? error.message : "PostHog statistics are unavailable";
    console.error(message);
    return null;
  }
}
