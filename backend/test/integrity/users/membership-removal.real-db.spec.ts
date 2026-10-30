import { UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { createAuthSession, createBranch, createUser } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

import {
    createKnownRefreshToken,
    expectInOrder,
    makeAuthSessionService,
    makeJwtStrategy,
    makeUserService,
    ownerActor,
    waitUntilBlocked,
    waitUntilBlockedCount,
    withDeadline,
} from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";
import type { PrismaService } from "infrastructure/database/prisma.service";

/**
 * SI-USER-06: authority removal versus live sessions.
 *
 * 1. `UserService.deleteBranchMembership` (via `UserService.delete(id, branchId)`)
 *    revokes the target's live sessions when the membership in the session's
 *    selected branch is removed — asserted end to end: the session row is revoked,
 *    jwt.strategy refuses the still-unexpired access token, and refresh answers
 *    AUTH_SESSION_REVOKED.
 * 2. `UserService.deleteGlobalUser`'s last-owner guard holds under concurrency:
 *    two deletions racing on a two-owner world lock every owner row in one
 *    deterministic order, so at most one succeeds and the system is never left
 *    with zero owners. The interleaving is forced: the first delete is paused
 *    inside its transaction (holding both owner row locks, delete not yet sent)
 *    while the second is proven — from `pg_stat_activity` — to be queued on the
 *    first owner's row lock.
 *
 * Real UserService / JwtStrategy / AuthSessionService over the real database.
 */
describeReal("membership removal and the concurrent last-owner guard (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    const CASE_TIMEOUT_MS = 20_000;

    beforeAll(async () => {
        handle = await createIntegrityPrisma();
    });

    beforeEach(() => {
        tracker = new RowTracker();
    });

    afterEach(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
    });

    afterAll(async () => {
        if (handle) await closeIntegrityPrisma(handle);
    });

    invariant(
        "SI-USER-06",
        "removing a branch membership revokes the sessions whose selected branch it was",
        async () => {
            const service = makeUserService(handle.service);
            const authSession = makeAuthSessionService(handle.service);
            const strategy = makeJwtStrategy(handle.service);

            const branch = await createBranch(handle.raw, tracker);
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const member = await createUser(
                handle.raw,
                tracker,
                { role: "user", approvalStatus: "approved" },
                { membership: { branchId: branch.id } },
            );
            const { session } = await createAuthSession(
                handle.raw,
                tracker,
                { userId: member.id },
                { selectedBranchId: branch.id },
                { refreshToken: { activeMarker: null } },
            );
            const known = await createKnownRefreshToken(handle.raw, tracker, session.id);

            await service.delete(member.id, branch.id, ownerActor(owner.id));

            const membershipCount = await handle.raw.user_branch.count({
                where: { userId: member.id, branchId: branch.id },
            });
            expect(membershipCount).toBe(0);
            const sessionAfter = await handle.raw.auth_session.findUniqueOrThrow({ where: { id: session.id } });
            expect(sessionAfter.revokedAt).not.toBeNull();
            expect(sessionAfter.revokedReason).toBe("membership_deleted");

            // The still-cryptographically-valid access token is refused at the next request.
            await expect(strategy.validate({
                sub: member.id,
                sid: session.id,
                role: member.role,
                tokenVersion: member.tokenVersion,
                type: "access",
                branchId: branch.id,
            })).rejects.toBeInstanceOf(UnauthorizedException);

            // And the refresh token of that session cannot rotate anymore.
            await expect(authSession.rotateRefreshToken(known.rawToken)).rejects.toMatchObject({
                response: { code: "AUTH_SESSION_REVOKED" },
            });
        },
    );

    invariant(
        "SI-USER-06",
        "concurrent deletion of both owners can never leave zero owners (forced interleaving, exactly two owners)",
        async () => {
            const service = makeUserService(handle.service);
            const ownerA = await createUser(handle.raw, tracker, { role: "owner" });
            const ownerB = await createUser(handle.raw, tracker, { role: "owner" });
            // Global last-owner protection requires an otherwise empty owner world.
            // Fail on leaked fixtures instead of silently demoting another test's rows.
            expect(await handle.raw.user.count({ where: { role: "owner" } })).toBe(2);

            const events: string[] = [];
            let paused = false;

            /**
             * The first delete's service: paused inside its transaction right before the
             * target user row is deleted — by then it holds FOR UPDATE locks on BOTH
             * owner rows in sorted order, which is exactly the serialization point the
             * last-owner guard depends on.
             */
            const firstDeleteService = new Proxy(handle.service, {
                get(target, key) {
                    if (key === "$transaction") {
                        return async (
                            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
                            ...rest: unknown[]
                        ) => {
                            const wrap = (tx: Prisma.TransactionClient): Prisma.TransactionClient =>
                                new Proxy(tx, {
                                    get(inner, innerKey) {
                                        if (innerKey === "user") {
                                            const delegate = Reflect.get(inner, innerKey, inner) as unknown as Record<string, unknown>;
                                            return new Proxy(delegate, {
                                                get(model, method) {
                                                    const value = Reflect.get(model, method, model);
                                                    if (method !== "delete" || typeof value !== "function") {
                                                        return typeof value === "function" ? value.bind(model) : value;
                                                    }
                                                    return async (...args: unknown[]) => {
                                                        if (!paused) {
                                                            paused = true;
                                                            events.push("FIRST_DELETE_HELD_BOTH_OWNER_LOCKS");
                                                            await waitUntilBlocked(
                                                                handle.raw,
                                                                /FROM\s+"user"[\s\S]*FOR\s+UPDATE/,
                                                            );
                                                            events.push("SECOND_DELETE_BLOCKED_ON_OWNER_LOCK");
                                                        }
                                                        return await (value as (...a: unknown[]) => Promise<unknown>)
                                                            .apply(model, args);
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

            // Deterministic wiring: a separate raw transaction PRIMES the first owner row
            // lock, so PostgreSQL queues both deletes behind it (sorted owner-lock order)
            // and the grant order on release is first-in-first-out.
            let firstDelete: Promise<{ kind: string; error?: unknown; value?: unknown }> | undefined;
            let secondDelete: Promise<{ kind: string; error?: unknown; value?: unknown }> | undefined;
            await withDeadline(handle.raw.$transaction(async (rx) => {
                await rx.$queryRaw(Prisma.sql`SELECT "id" FROM "user" WHERE "id" = CAST(${ownerA.id} AS UUID) FOR UPDATE`);
                firstDelete = makeUserService(firstDeleteService).delete(ownerA.id, undefined, ownerActor(ownerB.id))
                    .then(
                        (value: unknown) => ({ kind: "resolved" as const, value }),
                        (error: unknown) => ({ kind: "rejected" as const, error }),
                    );
                await waitUntilBlocked(handle.raw, /FROM\s+"user"[\s\S]*FOR\s+UPDATE/);
                events.push("FIRST_DELETE_QUEUED_BEHIND_PRIMING_LOCK");
                // Each owner is deleted by the OTHER owner's identity (a self-delete of an
                // owner is refused by design).
                secondDelete = service.delete(ownerB.id, undefined, ownerActor(ownerA.id))
                    .then(
                        (value: unknown) => ({ kind: "resolved" as const, value }),
                        (error: unknown) => ({ kind: "rejected" as const, error }),
                    );
                await waitUntilBlockedCount(handle.raw, /FROM\s+"user"[\s\S]*FOR\s+UPDATE/, 2);
                events.push("BOTH_DELETES_QUEUED_BEHIND_PRIMING_LOCK");
            }), CASE_TIMEOUT_MS, "priming transaction did not settle");
            if (!firstDelete || !secondDelete) {
                throw new Error("SI-USER-06 wrong-reason failure: deletes did not start inside the priming transaction");
            }

            // The priming lock is released: the first delete takes both owner locks
            // (sorted order), reaches its delete paused while still holding them; the
            // second delete is proven queued on those locks; then the first commit lands
            // and the second delete must not complete as a second owner deletion.
            const firstOutcome = (await withDeadline(firstDelete, CASE_TIMEOUT_MS, "first owner delete did not settle")) as { kind: string; error?: unknown };
            const secondOutcome = (await withDeadline(secondDelete, CASE_TIMEOUT_MS, "second owner delete did not settle")) as { kind: string; error?: unknown; errorName?: string };

            expect(firstOutcome).toMatchObject({ kind: "resolved" });
            expect(secondOutcome).toMatchObject({ kind: "rejected" });

            expect(paused).toBe(true);
            expectInOrder(events, [
                "FIRST_DELETE_QUEUED_BEHIND_PRIMING_LOCK",
                "BOTH_DELETES_QUEUED_BEHIND_PRIMING_LOCK",
                "FIRST_DELETE_HELD_BOTH_OWNER_LOCKS",
                "SECOND_DELETE_BLOCKED_ON_OWNER_LOCK",
            ]);

            // After the winner commits (its target row ownerA is gone), the loser
            // resumes: it is blocked on its FOR UPDATE of that same (sorted-first)
            // owner row, which the winner just deleted. The loser's rejection is
            // therefore the documented serialization abort (SQLSTATE 40001 "could
            // not serialize access"), NOT a silent second owner deletion. The
            // explicit last-owner 409 (REQUEST_CONFLICT) guard itself is proven by
            // the serial-pair test below.
            const loserMessage = secondOutcome.error instanceof Error
                ? secondOutcome.error.message
                : String(secondOutcome.error);
            const loserReason = /could not serialize access|40001/.test(loserMessage)
                ? "serialization-abort"
                : (/REQUEST_CONFLICT/.test(loserMessage) ? "last-owner-guard" : "unexpected");
            if (loserReason === "unexpected") {
                throw new Error(
                    `SI-USER-06 wrong-reason failure: the losing owner delete failed as neither the documented ` +
                        `serialization abort nor the last-owner guard: ${loserMessage}`,
                );
            }

            // The core invariant holds for the WHOLE world, not just for this race's
            // two rows: exactly one owner survives, and it is the owner whose delete
            // was queued last.
            const ownerCountAfter = await handle.raw.user.count({ where: { role: "owner" } });
            const ownersLeft = await handle.raw.user.findMany({
                where: { role: "owner", id: { in: [ownerA.id, ownerB.id] } },
                select: { id: true },
            });
            expect(ownersLeft.map(({ id }) => id)).toEqual([ownerB.id]);
            expect(ownerCountAfter).toBe(1);
        },
    );

    invariant(
        "SI-USER-06",
        "after one owner delete succeeds, deleting the now-last owner is refused with 409 REQUEST_CONFLICT (serial guard)",
        async () => {
            const service = makeUserService(handle.service);
            const ownerA = await createUser(handle.raw, tracker, { role: "owner" });
            const ownerB = await createUser(handle.raw, tracker, { role: "owner" });
            expect(await handle.raw.user.count({ where: { role: "owner" } })).toBe(2);

            // With exactly two owners the first delete passes the guard and commits.
            await expect(
                service.delete(ownerA.id, undefined, ownerActor(ownerB.id)),
            ).resolves.toBeUndefined();
            expect(await handle.raw.user.count({ where: { role: "owner" } })).toBe(1);

            // The second delete now faces a one-owner world. Its actor identity
            // (ownerA) is already deleted, but the actor check only requires a
            // distinct userId — and the lock-every-owner last-owner guard must refuse
            // the deletion of the final owner with 409 REQUEST_CONFLICT.
            await expect(
                service.delete(ownerB.id, undefined, ownerActor(ownerA.id)),
            ).rejects.toMatchObject({
                status: 409,
                response: {
                    code: "REQUEST_CONFLICT",
                    errors: expect.arrayContaining([
                        expect.objectContaining({ detail: expect.stringContaining("마지막 글로벌 소유자") }),
                    ]),
                },
            });

            // The refusal leaves the last owner untouched: the world still has one owner.
            const lastOwner = await handle.raw.user.findUniqueOrThrow({
                where: { id: ownerB.id },
                select: { role: true },
            });
            expect(lastOwner.role).toBe("owner");
            expect(await handle.raw.user.count({ where: { role: "owner" } })).toBe(1);
        },
    );
});
