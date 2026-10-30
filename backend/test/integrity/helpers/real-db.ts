import { PrismaClient } from "@prisma/client";

import { PrismaService } from "infrastructure/database/prisma.service";

/**
 * Shared gate for the real-PostgreSQL state-integrity specs. Every database touch
 * of an integrity spec sits inside `describeReal` + `beforeAll`, so the default
 * unit suite (no STATE_INTEGRITY_REAL_DB, no database available) imports these
 * modules harmlessly and skips the real-DB describes. Never loosen the throwaway
 * guard and never call it at import time.
 */
export const STATE_INTEGRITY_ENABLED = process.env["STATE_INTEGRITY_REAL_DB"] === "1";
export const describeReal = STATE_INTEGRITY_ENABLED ? describe : describe.skip;

// Byte-for-byte the THROWAWAY_URL of test/prisma/eformsign-void-fences.real-db.spec.ts
// and test/prisma/holiday-review.real-db.spec.ts: a local (localhost/127.0.0.1) URL,
// no password in the URL, and a database whose name contains "throwaway".
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;

/**
 * Refuses to run unless DATABASE_URL and DIRECT_URL are both set, identical, and
 * point at a local throwaway database. Must be called inside `beforeAll` (or from
 * `createIntegrityPrisma`) — never at module scope, because the unit suite imports
 * every spec without a database.
 */
export function assertThrowawayTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
        throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL must be the same local throwaway database");
    }
}

/** A connected real `PrismaService` (for repositories/services) plus a plain `PrismaClient` (for out-of-band verification). */
export interface IntegrityPrisma {
    service: PrismaService;
    raw: PrismaClient;
}

/**
 * Connects a real `PrismaService` and a plain `PrismaClient` to the guarded
 * throwaway database. The service is usable by repositories/services exactly the
 * way test/prisma/eformsign-void-fences.real-db.spec.ts constructs them over a
 * real database (`new SbEformsignDocRepository(handle.service)`).
 */
export async function createIntegrityPrisma(): Promise<IntegrityPrisma> {
    assertThrowawayTarget();
    const service = new PrismaService();
    const raw = new PrismaClient();
    await service.$connect();
    await raw.$connect();
    return { service, raw };
}

/** Disconnects both clients of {@link IntegrityPrisma}. */
export async function closeIntegrityPrisma(handle: IntegrityPrisma): Promise<void> {
    await handle.raw.$disconnect();
    await handle.service.$disconnect();
}
