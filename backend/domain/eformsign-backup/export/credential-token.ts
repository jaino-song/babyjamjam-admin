import { createHash, randomBytes } from "node:crypto";

export const EXPORT_TOKEN_PREFIX = "ebx_";
const BEARER_PREFIX = "Bearer ";
const TOKEN_SHAPE = /^ebx_[A-Za-z0-9_-]{43}$/;

/** `ebx_` + base64url of 32 random bytes (43 chars). The raw value is shown once, only its hash is stored. */
export function generateExportToken(): string {
    return EXPORT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashExportToken(raw: string): string {
    return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Exact `Bearer <token>`: one space, no trimming, case-sensitive scheme. */
export function parseExportBearer(header: string | undefined): string | null {
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) return null;
    const token = header.slice(BEARER_PREFIX.length);
    return TOKEN_SHAPE.test(token) ? token : null;
}
