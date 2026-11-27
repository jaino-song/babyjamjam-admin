const ISOLATED_CASE_KEY_TARGET =
    /^postgresql:\/\/[A-Za-z0-9_.-]+@127\.0\.0\.1:62295\/throwaway_baby_keys_(?:worker|verify)(?:_[A-Za-z0-9]+)*$/;
const CI_CASE_KEY_TARGET = /^postgresql:\/\/postgres@(localhost|127\.0\.0\.1):5432\/throwaway_ci$/;

export function assertBabyRecordKeyTestTarget(env: NodeJS.ProcessEnv): void {
    const url = env["DATABASE_URL"];
    const isCi = env["CI"] === "true" || env["CI"] === "1";
    if (env["STATE_INTEGRITY_REAL_DB"] !== "1" || !url || url !== env["DIRECT_URL"] || url !== url.trim()
        || !(ISOLATED_CASE_KEY_TARGET.test(url) || (isCi && CI_CASE_KEY_TARGET.test(url)))) {
        throw new Error("Refusing case-key staging outside an approved disposable PostgreSQL database");
    }
}
