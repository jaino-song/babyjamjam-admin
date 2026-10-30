import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";

import { AdminAuditActor, AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { AuthSessionService } from "application/services/auth-session.service";
import { SystemAdminService } from "application/services/system-admin.service";
import { UserService } from "application/services/user.service";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

import type { RowTracker } from "../helpers/tracker";

/**
 * Local helpers for the `users` state-integrity area. Everything here is owned
 * by this area folder (the merged harness under `helpers/` is read-only for
 * phase-2 units): service wiring over a real PrismaService, a known-secret
 * refresh-token factory, pg_stat_activity lock-wait detection, and cleanup for
 * the auth tables the harness tracker cannot track (`auth_token` has no
 * TrackedModel entry and `auth_flow_state` has no FK at all).
 */

export const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

export function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function asPrismaService(client: PrismaClient): PrismaService {
    return client as unknown as PrismaService;
}

export function ownerActor(userId: string): AdminAuditActor {
    return { userId, globalRole: "owner" };
}

/** Real UserService over the real database; only owner-only global paths are exercised. */
export function makeUserService(prisma: PrismaService): UserService {
    return new UserService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        prisma,
        new AdminAuditEventWriter(prisma),
    );
}

/**
 * Real AuthSessionService over the real database. `signAsync` is the only stub:
 * it returns the base64url of the JSON claims so tests can inspect exactly what
 * would be baked into an access token.
 */
export function makeAuthSessionService(prisma: PrismaService): AuthSessionService {
    const jwt = {
        signAsync: async (payload: unknown): Promise<string> =>
            Buffer.from(JSON.stringify(payload)).toString("base64url"),
    } as unknown as JwtService;
    return new AuthSessionService(prisma, jwt);
}

/** Decodes the inspectable access tokens produced by {@link makeAuthSessionService}. */
export function decodeAccessToken(token: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Record<string, unknown>;
}

export function makeSystemAdminService(prisma: PrismaService): SystemAdminService {
    return new SystemAdminService(prisma, new AdminAuditEventWriter(prisma));
}

/**
 * Real JwtStrategy. The strategy constructor reads the JWT secret at construction
 * time, so a local test literal is set before wiring (never a real secret).
 * The literal is always SET (never inherited) and restored afterwards, so the
 * helper never leaks environment mutation across suites or processes.
 */
export function makeJwtStrategy(prisma: PrismaService): JwtStrategy {
    const testSecret = "si-users-local-integrity-test-secret";
    const previous = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = testSecret;
    try {
        return new JwtStrategy(prisma);
    } finally {
        if (previous === undefined) {
            delete process.env["JWT_SECRET"];
        } else {
            process.env["JWT_SECRET"] = previous;
        }
    }
}

export function makeTenantGuard(prisma: PrismaService): { guard: TenantGuard; context: TenantContext } {
    const context = new TenantContext();
    return { guard: new TenantGuard(prisma, context), context };
}

/** A Nest ExecutionContext whose HTTP request carries the jwt-strategy principal. */
export function tenantRequestContext(user: {
    userId: string;
    role: string | null;
    branchId?: string;
}): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    } as unknown as ExecutionContext;
}

export interface KnownRefreshTokenResult {
    /** The `id.secret` string a client would present to POST /auth/refresh. */
    rawToken: string;
    id: string;
}

/**
 * Creates one ACTIVE `auth_refresh_token` row whose secret the test knows.
 * Pass `factoryTokenActiveMarker: false` when the session came from
 * `createAuthSession`, whose factory token must then stay inactive so the
 * `(sessionId, activeMarker)` uniqueness holds.
 */
export async function createKnownRefreshToken(
    prisma: PrismaClient | PrismaService,
    tracker: RowTracker,
    sessionId: string,
    options: { secret?: string; expiresAt?: Date } = {},
): Promise<KnownRefreshTokenResult> {
    const id = crypto.randomUUID();
    const secret = options.secret ?? `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const row = await prisma.auth_refresh_token.create({
        data: {
            id,
            sessionId,
            secretHash: sha256Hex(secret),
            expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        },
    });
    tracker.track("auth_refresh_token", row.id);
    return { rawToken: `${id}.${secret}`, id };
}

/**
 * Proves, from the database's own state, that some backend is queued on a
 * heavyweight lock in a statement matching `statement` (same technique as
 * test/prisma/eformsign-void-fences.real-db.spec.ts). Bounded so a deadlock
 * fails the test instead of hanging it.
 */
export async function waitUntilBlocked(
    raw: PrismaClient,
    statement: RegExp,
    timeoutMs = 5_000,
): Promise<void> {
    await waitUntilBlockedCount(raw, statement, 1, timeoutMs);
}

/**
 * Same as {@link waitUntilBlocked} but waits until AT LEAST `minWaiters` backends
 * are queued on a heavyweight lock matching `statement`. A plain existence check
 * cannot prove "BOTH" waiter claims: the match from the first waiter satisfies it
 * even when the second contender never queued. Callers asserting that N racing
 * transactions are all blocked must use the counting form.
 */
export async function waitUntilBlockedCount(
    raw: PrismaClient,
    statement: RegExp,
    minWaiters: number,
    timeoutMs = 5_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let waiting: string[] = [];
    for (;;) {
        const rows = await raw.$queryRaw<Array<{ query: string; pid: number }>>(Prisma.sql`
            SELECT pid, query
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
        `);
        waiting = rows.map((row) => row.query);
        const matching = waiting.filter((query) => statement.test(query)).length;
        if (matching >= minWaiters) return;
        if (Date.now() > deadline) {
            throw new Error(
                `only ${matching} backend(s) (needed ${minWaiters}) blocked on ${statement}; ` +
                    `waiting statements: ${JSON.stringify(waiting)}`,
            );
        }
        await sleep(20);
    }
}

/** Rejects (and clears its timer) instead of waiting forever for `promise`. */
export async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** Every named event happened, in exactly this relative order. */
export function expectInOrder(events: readonly string[], expected: readonly string[]): void {
    const positions = expected.map((name) => events.indexOf(name));
    expect({ events, missing: expected.filter((_, index) => positions[index] === -1) })
        .toEqual({ events, missing: [] });
    expect({ events, positions }).toEqual({
        events,
        positions: [...positions].sort((left, right) => left - right),
    });
}

/**
 * Demotes every global owner row except the given pair so a two-owner invariant
 * holds in the WHOLE world, then asserts exactly two owners remain. Needed
 * because sibling tests in one suite (and leaked rows from earlier runs) leave
 * `role: 'owner'` users behind; without isolation, owner-count assertions and
 * last-owner guards see a permanently non-zero extra supply. Demotion (not
 * deletion) keeps other suites' tracker-cleaned rows intact.
 */
export async function isolateExactTwoOwnerWorld(
    raw: PrismaClient,
    ownerAId: string,
    ownerBId: string,
): Promise<void> {
    await raw.user.updateMany({
        where: { role: "owner", id: { notIn: [ownerAId, ownerBId] } },
        data: { role: "user" },
    });
    const ownerCount = await raw.user.count({ where: { role: "owner" } });
    if (ownerCount !== 2) {
        throw new Error(`owner isolation failed: expected exactly 2 owners, found ${ownerCount}`);
    }
}

/**
 * Rows this area creates in tables the harness tracker cannot track:
 * `auth_token` (no TrackedModel entry) and `auth_flow_state` (no FK at all, so
 * nothing cascades it). Deleted explicitly before `tracker.cleanup()`.
 */
export interface LocalAuthRows {
    authTokenIds: string[];
    flowStateTokenHashes: string[];
}

export function newLocalAuthRows(): LocalAuthRows {
    return { authTokenIds: [], flowStateTokenHashes: [] };
}

export async function deleteLocalAuthRows(raw: PrismaClient, rows: LocalAuthRows): Promise<void> {
    if (rows.authTokenIds.length > 0) {
        await raw.auth_token.deleteMany({ where: { id: { in: rows.authTokenIds } } });
    }
    if (rows.flowStateTokenHashes.length > 0) {
        await raw.auth_flow_state.deleteMany({ where: { tokenHash: { in: rows.flowStateTokenHashes } } });
    }
}
