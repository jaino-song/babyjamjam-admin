/** Keep independent statistics requests usable when one provider query fails. */
export async function loadPostHogStat<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch {
    // Provider payloads can contain credentials or PII; log only the safe failure category.
    console.error("PostHog statistics are unavailable");
    return null;
  }
}
