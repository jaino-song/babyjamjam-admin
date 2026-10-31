/** Prisma may expose PostgreSQL conflicts in raw-query metadata or unknown-request messages. */
export function isTransactionConflict(error: unknown): boolean {
    const seen = new Set<object>();
    while (typeof error === "object" && error !== null && !seen.has(error)) {
        seen.add(error);
        const code = "code" in error ? error.code : undefined;
        const message = "message" in error ? error.message : undefined;
        if (code === "P2034") return true;
        if ([code, message].some((value) => typeof value === "string" && /\b(?:40P01|40001)\b/.test(value))) {
            return true;
        }
        // P2010 carries the SQLSTATE in meta; guard against cyclic error metadata.
        error = "meta" in error ? error.meta : undefined;
    }
    return false;
}
