import type { ProblemOutcome } from "@babyjamjam/shared";

const KNOWN_PROBLEM_OUTCOMES: readonly string[] = [
    "NOT_APPLIED",
    "FAILED",
    "PARTIALLY_APPLIED",
    "UNKNOWN",
];

/**
 * Read the additive headless envelope `outcome` field (BJJ-319 phases 5-4a
 * dispatch / 5-4b finalize) defensively. Only a registered outcome value is
 * trusted; every other shape — absent on a legacy envelope, malformed, a
 * reason token — reads as `null`, so callers keep classifying through the
 * legacy reason/fallbackHint branches unchanged.
 */
export function readHeadlessOutcome(value: unknown): ProblemOutcome | null {
    return typeof value === "string" && KNOWN_PROBLEM_OUTCOMES.includes(value)
        ? (value as ProblemOutcome)
        : null;
}
