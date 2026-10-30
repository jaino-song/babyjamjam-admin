import { Prisma } from "@prisma/client";

import { AuthService } from "application/services/auth.service";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { createUser } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";
import { SbAuthTokenRepository } from "infrastructure/database/repositories/sb.auth-token.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

import {
    deleteLocalAuthRows,
    newLocalAuthRows,
    sha256Hex,
    waitUntilBlocked,
    withDeadline,
} from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";

/**
 * SI-USER-07: single-use consumption of `auth_token` and the orphaned
 * `auth_flow_state` rows.
 *
 * 1. `SbAuthTokenRepository.consumeWithinTx` (infrastructure/database/
 *    repositories/sb.auth-token.repository.ts) must be atomic single-use: two
 *    concurrent consumptions of the same unconsumed token yield exactly one
 *    winner. Proven with forced interleaving: the winner's transaction is paused
 *    right after its `updateMany` consumed the row (holding the row lock,
 *    uncommitted) while the challenger is proven — from `pg_stat_activity` — to
 *    be queued on that UPDATE; only after the winner commits does the challenger
 *    re-evaluate `used_at IS NULL` and lose.
 * 2. `auth_flow_state` has no foreign key on `user_id`, so a user deletion
 *    leaves unconsumed flow states behind. The invariant that must still hold:
 *    such an orphaned state cannot complete a login/link flow — the completion
 *    path re-reads the user and refuses.
 *
 * Real SbAuthTokenRepository / AuthService over the real database.
 */
describeReal("single-use tokens and flow state orphans (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    const localRows = newLocalAuthRows();
    const CASE_TIMEOUT_MS = 20_000;

    beforeAll(async () => {
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        // `auth_token` and `auth_flow_state` rows are not tracker-tracked and
        // `auth_flow_state` has no FK that would cascade them away.
        await deleteLocalAuthRows(handle.raw, localRows);
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    invariant(
        "SI-USER-07",
        "concurrent consumption of one auth_token yields exactly one winner (forced interleaving)",
        async () => {
            const hashedTokenValue = `si-token-${crypto.randomUUID()}`;
            const user = await createUser(handle.raw, tracker, { role: "user", approvalStatus: "approved" });
            const tokenRow = await handle.raw.auth_token.create({
                data: {
                    userId: user.id,
                    token: hashedTokenValue,
                    type: "email_verification",
                    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
                },
            });
            localRows.authTokenIds.push(tokenRow.id);

            const repository = new SbAuthTokenRepository(handle.service);
            const rawRepository = new SbAuthTokenRepository(handle.raw as unknown as PrismaService);

            const events: string[] = [];
            let paused = false;

            /**
             * The winner's service: inside its consumption transaction, right after the
             * `updateMany` consumed the row (row lock held, nothing committed), the
             * transaction is paused while the challenger starts and is proven queued on
             * the `auth_token` UPDATE.
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
                                        if (innerKey === "auth_token") {
                                            const delegate = Reflect.get(inner, innerKey, inner) as unknown as Record<string, unknown>;
                                            return new Proxy(delegate, {
                                                get(model, method) {
                                                    const value = Reflect.get(model, method, model);
                                                    if (method !== "updateMany" || typeof value !== "function") {
                                                        return typeof value === "function" ? value.bind(model) : value;
                                                    }
                                                    return async (...args: unknown[]) => {
                                                        const result = await (value as (...a: unknown[]) => Promise<unknown>)
                                                            .apply(model, args);
                                                        if (!paused) {
                                                            paused = true;
                                                            events.push("WINNER_CONSUMED_UNCOMMITTED");
                                                            await waitUntilBlocked(handle.raw, /UPDATE[\s\S]*?"auth_token"/);
                                                            events.push("CHALLENGER_BLOCKED_ON_TOKEN_ROW");
                                                        }
                                                        return result;
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

            // Deterministic wiring: a separate raw transaction PRIMES the token row lock,
            // so PostgreSQL queues the winner then the challenger behind it and the grant
            // order on release is first-in-first-out.
            let firstAttempt: Promise<boolean> | undefined;
            let secondAttempt: Promise<boolean> | undefined;
            await withDeadline(handle.raw.$transaction(async (rx) => {
                await rx.$queryRaw(Prisma.sql`SELECT "id" FROM "auth_token" WHERE "id" = CAST(${tokenRow.id} AS UUID) FOR UPDATE`);
                // The repository only exposes consumeWithinTx(tx, ...): drive both attempts
                // through interactive transactions on the two real clients.
                firstAttempt = (winnerService.$transaction as unknown as (
                    cb: (tx: Prisma.TransactionClient) => Promise<boolean>,
                ) => Promise<boolean>)((tx) => repository.consumeWithinTx(tx, hashedTokenValue, "email_verification"));
                await waitUntilBlocked(handle.raw, /UPDATE[\s\S]*?"auth_token"/);
                events.push("WINNER_QUEUED_BEHIND_PRIMING_LOCK");
                secondAttempt = handle.raw.$transaction<boolean>((rx) =>
                    rawRepository.consumeWithinTx(rx, hashedTokenValue, "email_verification"));
                await waitUntilBlocked(handle.raw, /UPDATE[\s\S]*?"auth_token"/);
                events.push("BOTH_CONSUMPTIONS_QUEUED_BEHIND_PRIMING_LOCK");
            }), CASE_TIMEOUT_MS, "priming transaction did not settle");
            if (!firstAttempt || !secondAttempt) {
                throw new Error("SI-USER-07 wrong-reason failure: consumptions did not start inside the priming transaction");
            }

            // The priming lock is released: the winner consumes the row (paused here while
            // still holding the row lock), the challenger is proven queued, then the
            // winner commits; the challenger re-evaluates `used_at IS NULL` and loses.
            await expect(firstAttempt).resolves.toBe(true);
            await expect(secondAttempt).resolves.toBe(false);

            expect(paused).toBe(true);
            expect(events).toEqual([
                "WINNER_QUEUED_BEHIND_PRIMING_LOCK",
                "BOTH_CONSUMPTIONS_QUEUED_BEHIND_PRIMING_LOCK",
                "WINNER_CONSUMED_UNCOMMITTED",
                "CHALLENGER_BLOCKED_ON_TOKEN_ROW",
            ]);

            const after = await handle.raw.auth_token.findUniqueOrThrow({ where: { id: tokenRow.id } });
            expect(after.usedAt).not.toBeNull();
        },
    );

    invariant(
        "SI-USER-07",
        "an unconsumed flow state of a deleted user cannot complete its login flow",
        async () => {
            const rawToken = `si-flow-${crypto.randomUUID()}`;
            const user = await createUser(handle.raw, tracker, { role: "user", approvalStatus: "approved" });
            const state = await handle.raw.auth_flow_state.create({
                data: {
                    kind: "pending_account_onboarding",
                    tokenHash: sha256Hex(rawToken),
                    userId: user.id,
                    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                },
            });
            localRows.flowStateTokenHashes.push(state.tokenHash);

            // auth_flow_state.user_id has no FK: the state survives the user deletion.
            await handle.raw.user.delete({ where: { id: user.id } });
            const orphan = await handle.raw.auth_flow_state.findUnique({ where: { id: state.id } });
            expect(orphan).not.toBeNull();
            expect(orphan?.consumedAt).toBeNull();

            const authService = new AuthService(
                handle.service,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
            );
            await expect(authService.getPendingAccountOnboarding(rawToken)).rejects.toMatchObject({
                response: { code: "AUTH_REQUIRED" },
            });

            // The orphan stays unconsumed: refused without being marked used.
            const after = await handle.raw.auth_flow_state.findUniqueOrThrow({ where: { id: state.id } });
            expect(after.consumedAt).toBeNull();
        },
    );
});
