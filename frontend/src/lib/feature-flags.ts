/**
 * Frontend feature flags. Read at module load from
 * `NEXT_PUBLIC_FEATURE_FLAGS` (comma-separated list of enabled flag names)
 * or per-flag `NEXT_PUBLIC_FEATURE_<NAME>` / `NEXT_PUBLIC_FEATURE_DISABLE_<NAME>`
 * env vars set to "1"/"true".
 *
 * Flags are static for the page lifetime — toggling them requires a reload.
 */

export type FeatureFlag = "headlessDispatch";

const FLAG_ENV_VARS: Record<FeatureFlag, string> = {
    headlessDispatch: "NEXT_PUBLIC_FEATURE_HEADLESS_DISPATCH",
};

const FLAG_DISABLE_ENV_VARS: Record<FeatureFlag, string> = {
    headlessDispatch: "NEXT_PUBLIC_FEATURE_DISABLE_HEADLESS_DISPATCH",
};

/**
 * Default-on flags. The headless dispatch path is preferred — when the
 * backend can't deliver (Chromium missing, selector miss, eformsign 5xx), it
 * already returns `ok: false` and the call sites fall back to the existing
 * iframe modal automatically. Set the matching `_DISABLE_` env var to opt out
 * if a deploy needs the iframe path forced on without rebuilding.
 */
const FLAG_DEFAULTS: Record<FeatureFlag, boolean> = {
    headlessDispatch: true,
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
    // Explicit disable wins.
    if (isTruthyEnv(process.env[FLAG_DISABLE_ENV_VARS[flag]])) {
        return false;
    }
    if (ENABLED_LIST.has(flag)) return true;
    if (isTruthyEnv(process.env[FLAG_ENV_VARS[flag]])) return true;
    return FLAG_DEFAULTS[flag] ?? false;
}
