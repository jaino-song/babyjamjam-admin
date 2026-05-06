/**
 * Frontend feature flags. Read at module load from
 * `NEXT_PUBLIC_FEATURE_FLAGS` (comma-separated list of enabled flag names)
 * or per-flag `NEXT_PUBLIC_FEATURE_<NAME>` env vars set to "1"/"true".
 *
 * Flags are static for the page lifetime — toggling them requires a reload.
 */

export type FeatureFlag = "headlessDispatch";

const FLAG_ENV_VARS: Record<FeatureFlag, string> = {
    headlessDispatch: "NEXT_PUBLIC_FEATURE_HEADLESS_DISPATCH",
};

function parseFlagList(): Set<string> {
    const raw = process.env.NEXT_PUBLIC_FEATURE_FLAGS ?? "";
    return new Set(
        raw
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
    );
}

const ENABLED_LIST = parseFlagList();

function isTruthyEnv(value: string | undefined): boolean {
    if (!value) return false;
    return value === "1" || value.toLowerCase() === "true";
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
    if (ENABLED_LIST.has(flag)) return true;
    return isTruthyEnv(process.env[FLAG_ENV_VARS[flag]]);
}
