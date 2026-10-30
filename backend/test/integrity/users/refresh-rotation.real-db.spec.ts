import { Prisma } from "@prisma/client";

import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { createAuthSession, createUser } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

import {
    createKnownRefreshToken,
    expectInOrder,
    makeAuthSessionService,
    waitUntilBlocked,
    withDeadline,
} from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";
import type { PrismaService } from "infrastructure/database/prisma.service";

/**
 * SI-USER-05: refresh-rotation integrity in `AuthSessionService.rotateRefreshToken`
 * (application/services/auth-session.service.ts). Three invariants:
 *
 * 1. a session holds at most ONE active refresh token — enforced by the
 *    `auth_refresh_token_session_active_key` unique index on `(sessionId, activeMarker)`;
 * 2. two rotations racing on the SAME token produce exactly one winner: the
 *    session row `FOR UPDATE` lock (lockSession) serialises them, and the loser
 *    lands in the concurrent-replay grace path (AUTH_REFRESH_REPLAY_CONCURRENT)
 *    instead of revoking the family. Proven with forced interleaving: the winner
 *    is paused inside its transaction (holding the session lock, successor row
 *    inserted, uncommitted) while the loser is proven — from
 *    `pg_stat_activity` — to be queued on that lock;
 * 3. reuse AFTER the grace window revokes the whole family
 *    (session + every refresh token, reason `refresh_token_reuse`). `usedAt` is
 *    backdated so no real time has to pass.
 *
 * Real AuthSessionService over the real database; only `signAsync` is stubbed
 * (it returns the base64url of the claims it was given).
 */
describeReal("refresh token rotation (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    const CASE_TIMEOUT_MS = 20_000;

    beforeAll(async () => {
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    async function createApprovedUserWithSession() {
        const user = await createUser(handle.raw, tracker, { role: "user", approvalStatus: "approved" });
        const { session } = await createAuthSession(
            handle.raw,
            tracker,
            { userId: user.id },
            {},
            { refreshToken: { activeMarker: null } },
        );
        const known = await createKnownRefreshToken(handle.raw, tracker, session.id);
        return { user, session, rawToken: known.rawToken, tokenId: known.id };
    }

    invariant(
        "SI-USER-05",
        "a session holds at most one active refresh token (session_active_key unique index)",
        async () => {
            const user = await createUser(handle.raw, tracker, { role: "user", approvalStatus: "approved" });
            const { session } = await createAuthSession(handle.raw, tracker, { userId: user.id });
            await expect(
                createKnownRefreshToken(handle.raw, tracker, session.id),
            ).rejects.toThrow(/Unique constraint failed on the fields: \(`session_id`, ?`active_marker`\)/);
        },
    );

    invariant(
        "SI-USER-05",
        "two rotations racing on the same token yield exactly one winner and no family revocation (forced interleaving)",
        async () => {
            const { session, rawToken } = await createApprovedUserWithSession();

            const events: string[] = [];
            let paused = false;

            /**
             * The lock winner's service: inside its rotation transaction, right after
             * the successor refresh token row is inserted (session row locked, nothing
             * committed), the transaction is paused while the challenger is proven -
             * from pg_stat_activity - to be queued on that session row lock.
             */
            const winnerService = new Proxy(handle.service, {
                get(target, key) {
                    if (key === "$transaction") {
                        return async (
                            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
                            ...rest: unknown[]
                        ) => {
                            const wrap = (tx: Prisma.TransactionClient): Prisma.TransactionClient =>
                                new Proxy(tx, {
                                    get(inner, innerKey) {
                                        if (innerKey === "auth_refresh_token") {
                                            const delegate = Reflect.get(inner, innerKey, inner) as unknown as Record<string, unknown>;
                                            return new Proxy(delegate, {
                                                get(model, method) {
                                                    const value = Reflect.get(model, method, model);
                                                    if (method !== "create" || typeof value !== "function") {
                                                        return typeof value === "function" ? value.bind(model) : value;
                                                    }
                                                    return async (...args: unknown[]) => {
                                                        const row = await (value as (...a: unknown[]) => Promise<unknown>)
                                                            .apply(model, args);
                                                        if (!paused) {
                                                            paused = true;
                                                            events.push("WINNER_SUCCESSOR_CREATED");
                                                            await waitUntilBlocked(
                                                                handle.raw,
                                                                /FROM\s+"auth_session"[\s\S]*FOR\s+UPDATE/,
                                                            );
                                                            events.push("CHALLENGER_BLOCKED_ON_SESSION_LOCK");
                                                        }
                                                        return row;
                                                    };
                                                },
                                            });
                                        }
                                        const value = Reflect.get(inner, innerKey, inner);
                                        return typeof value === "function" ? value.bind(inner) : value;
                                    },
                                });
                            return await (target.$transaction as unknown as (
                                cb: (tx: Prisma.TransactionClient) => Promise<unknown>,
                                ...opts: unknown[]
                            ) => Promise<unknown>).call(target, (tx) => callback(wrap(tx)), ...rest);
                        };
                    }
                    const value = Reflect.get(target, key, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            }) as unknown as PrismaService;

            // Deterministic wiring: a separate raw transaction PRIMES the session row
            // lock first, so PostgreSQL queues the winner then the challenger behind it
            // and the grant order on release is first-in-first-out.
            let winner: Promise<{ kind: string; error?: unknown; value?: unknown }> | undefined;
            let challenger: Promise<{ kind: string; error?: unknown; value?: unknown }> | undefined;
            await withDeadline(handle.raw.$transaction(async (rx) => {
                await rx.$queryRaw(Prisma.sql`SELECT "id" FROM "auth_session" WHERE "id" = CAST(${session.id} AS UUID) FOR UPDATE`);
                winner = makeAuthSessionService(winnerService).rotateRefreshToken(rawToken)
                    .then(
                        (value: unknown) => ({ kind: "resolved" as const, value }),
                        (error: unknown) => ({ kind: "rejected" as const, error }),
                    );
                await waitUntilBlocked(handle.raw, /FROM\s+"auth_session"[\s\S]*FOR\s+UPDATE/);
                events.push("WINNER_QUEUED_BEHIND_PRIMING_LOCK");
                challenger = makeAuthSessionService(handle.service).rotateRefreshToken(rawToken)
                    .then(
                        (value: unknown) => ({ kind: "resolved" as const, value }),
                        (error: unknown) => ({ kind: "rejected" as const, error }),
                    );
                await waitUntilBlocked(handle.raw, /FROM\s+"auth_session"[\s\S]*FOR\s+UPDATE/);
                events.push("BOTH_ROTATIONS_QUEUED_BEHIND_PRIMING_LOCK");
            }), CASE_TIMEOUT_MS, "priming transaction did not settle");
            if (!winner || !challenger) {
                throw new Error("SI-USER-05 wrong-reason failure: rotations did not start inside the priming transaction");
            }

            // The priming lock is released; the FIFO grant gives the winner the session
            // row, it consumes the token, inserts the successor (paused here), the
            // challenger is proven queued, then the winner commits and the challenger
            // resumes into the concurrent-replay path.
            const winnerOutcome = (await withDeadline(winner, CASE_TIMEOUT_MS, "rotation winner did not settle")) as { kind: string; error?: unknown; value?: unknown };
            const challengerOutcome = (await withDeadline(challenger, CASE_TIMEOUT_MS, "rotation challenger did not settle")) as { kind: string; error?: unknown; value?: unknown };

            expect(winnerOutcome).toMatchObject({ kind: "resolved" });
            expect(challengerOutcome).toMatchObject({
                kind: "rejected",
                error: expect.objectContaining({
                    response: expect.objectContaining({ code: "AUTH_REFRESH_REPLAY_CONCURRENT" }),
                }),
            });

            expect(paused).toBe(true);
            expectInOrder(events, [
                "WINNER_QUEUED_BEHIND_PRIMING_LOCK",
                "BOTH_ROTATIONS_QUEUED_BEHIND_PRIMING_LOCK",
                "WINNER_SUCCESSOR_CREATED",
                "CHALLENGER_BLOCKED_ON_SESSION_LOCK",
            ]);

            // The grace path must NOT revoke the family: the session survives, the
            // factory token stays untouched, the original token is the family's only
            // used row (consumed once by the winner), and exactly one successor exists.
            const sessionAfter = await handle.raw.auth_session.findUniqueOrThrow({ where: { id: session.id } });
            expect(sessionAfter.revokedAt).toBeNull();
            const tokens = await handle.raw.auth_refresh_token.findMany({
                where: { sessionId: session.id },
                orderBy: { createdAt: "asc" },
            });
            expect(tokens).toHaveLength(3); // inactive factory token + consumed original + winner's successor
            expect(tokens[0]).toMatchObject({ usedAt: null, revokedAt: null, activeMarker: null });
            expect(tokens[1]).toMatchObject({ usedAt: expect.any(Date), revokedAt: null, activeMarker: null });
            expect(tokens[2]).toMatchObject({ usedAt: null, revokedAt: null, activeMarker: "active" });
        },
    );

    invariant(
        "SI-USER-05",
        "reuse after the concurrency grace revokes the whole session family",
        async () => {
            const authSession = makeAuthSessionService(handle.service);
            const { session, rawToken, tokenId } = await createApprovedUserWithSession();

            await expect(authSession.rotateRefreshToken(rawToken)).resolves.toEqual(
                expect.objectContaining({ refreshToken: expect.any(String) }),
            );

            // Backdate the consumption past CONCURRENT_REFRESH_GRACE_MS (5s) instead of
            // waiting for real time to pass.
            await handle.raw.auth_refresh_token.update({
                where: { id: tokenId },
                data: { usedAt: new Date(Date.now() - 10_000) },
            });

            await expect(authSession.rotateRefreshToken(rawToken)).rejects.toMatchObject({
                response: { code: "AUTH_REFRESH_REUSED" },
            });

            const sessionAfter = await handle.raw.auth_session.findUniqueOrThrow({ where: { id: session.id } });
            expect(sessionAfter.revokedAt).not.toBeNull();
            expect(sessionAfter.revokedReason).toBe("refresh_token_reuse");
            const tokens = await handle.raw.auth_refresh_token.findMany({ where: { sessionId: session.id } });
            expect(tokens.length).toBeGreaterThanOrEqual(2);
            for (const token of tokens) {
                expect(token.revokedAt).not.toBeNull();
            }
        },
    );
});
