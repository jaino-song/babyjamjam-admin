import { Prisma } from "@prisma/client";
import { isTransactionConflict } from "application/utils/transaction-conflict";
import { randomUUID } from "node:crypto";

import { createBranch, createUser, createUserBranchMembership } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

import { makeSystemAdminService, makeUserService, ownerActor, sleep, waitUntilBlocked, withDeadline } from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";
import type { PrismaService } from "infrastructure/database/prisma.service";

function signal() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

// Keep real SQL and transaction boundaries; hooks control real-query interleaving
// and transaction-local PostgreSQL settings, never replace database outcomes.
function withHooks(prisma: PrismaService, hooks: {
    afterLock?: (query: Prisma.Sql) => Promise<void>;
    afterOwnershipRead?: () => Promise<void>;
    onTransactionError?: (error: unknown) => void;
    beforeTransaction?: (tx: Prisma.TransactionClient) => Promise<void>;
}): PrismaService {
    return new Proxy(prisma, {
        get(target, key) {
            if (key === "$transaction") {
                return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: {
                    isolationLevel?: Prisma.TransactionIsolationLevel;
                }) => {
                    try {
                        return await target.$transaction(async (tx) => {
                            await hooks.beforeTransaction?.(tx);
                            return callback(new Proxy(tx, {
                                get(client, property) {
                                    if (property === "$queryRaw") {
                                        return async (query: Prisma.Sql) => {
                                            const result = await tx.$queryRaw(query);
                                            await hooks.afterLock?.(query);
                                            return result;
                                        };
                                    }
                                    if (property === "branch") {
                                        return new Proxy(tx.branch, {
                                            get(model, method) {
                                                if (method === "findFirst") {
                                                    return async (args: Prisma.branchFindFirstArgs) => {
                                                        const result = await model.findFirst(args);
                                                        await hooks.afterOwnershipRead?.();
                                                        return result;
                                                    };
                                                }
                                                const value = Reflect.get(model, method, model);
                                                return typeof value === "function" ? value.bind(model) : value;
                                            },
                                        });
                                    }
                                    const value = Reflect.get(client, property, client);
                                    return typeof value === "function" ? value.bind(client) : value;
                                },
                            }));
                        }, { ...options, timeout: 15_000 });
                    } catch (error) {
                        hooks.onTransactionError?.(error);
                        throw error;
                    }
                };
            }
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

describeReal("branch ownership transfer serialization (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    beforeAll(async () => { handle = await createIntegrityPrisma(); });
    beforeEach(() => { tracker = new RowTracker(); });
    afterEach(async () => { await tracker.cleanup(handle.raw); });
    afterAll(async () => { if (handle) await closeIntegrityPrisma(handle); });

    async function user(prefix: string, role = "admin") {
        return createUser(handle.raw, tracker, {
            id: `${prefix}0000000-0000-4000-8000-${randomUUID().slice(-12)}`,
            role,
        });
    }

    async function ownedBranch(userId: string) {
        const branch = await createBranch(handle.raw, tracker, { ownerId: userId });
        await createUserBranchMembership(handle.raw, tracker, { userId, branchId: branch.id }, { role: "admin" });
        return branch;
    }

    // A paused winner holds its locks in JS, so any SQL user-lock waiter is the
    // challenger. Alternatively a broken lock/order lets the challenger reach
    // the hook. Both paths release normally, making mutations fail on outcomes.
    async function waitForChallenger(progressed: () => boolean) {
        await withDeadline((async () => {
            while (!progressed()) {
                const waiting = await handle.raw.$queryRaw<Array<{ query: string }>>(Prisma.sql`
                    SELECT query FROM pg_stat_activity
                    WHERE datname = current_database() AND pid <> pg_backend_pid()
                      AND wait_event_type = 'Lock'
                `);
                if (waiting.some(({ query }) => /FROM\s+"user"[\s\S]*FOR\s+UPDATE/.test(query))) return;
                await sleep(10);
            }
        })(), 5_000, "challenger neither queued on a user lock nor reached the pause hook");
    }

    function expectSuccessOrConflict(outcomes: PromiseSettledResult<unknown>[]) {
        expect(outcomes).toHaveLength(2);
        expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
        for (const outcome of outcomes) {
            if (outcome.status === "rejected") {
                expect(outcome.reason).toMatchObject({
                    status: 409,
                    response: expect.objectContaining({ code: "REQUEST_CONFLICT", outcome: "NOT_APPLIED" }),
                });
            }
        }
    }

    for (const action of ["reject", "approve"] as const) {
        invariant("SI-USER-13", `${action} retries a real deadlock against legacy membership repair without duplicate audit writes`, async () => {
            const old = await user("1");
            const branch = await createBranch(handle.raw, tracker, { ownerId: old.id });
            const unowned = await createBranch(handle.raw, tracker);
            const approver = await user("9", "owner");
            const actor = ownerActor(approver.id);
            const paused = signal();
            const release = signal();
            const errors: unknown[] = [];
            let firstLock = true;
            const repair = makeUserService(withHooks(handle.service, {
                // Make the admission waiter detect the cycle first, so its retry
                // (not repair's existing retry) is the behavior under test.
                beforeTransaction: async (tx) => { await tx.$executeRaw`SET LOCAL deadlock_timeout = '10s'`; },
                afterLock: async () => {
                    if (firstLock) { firstLock = false; paused.resolve(); await release.promise; }
                },
            })).update(old.id, { branchId: branch.id, branchRole: "admin", actor });
            const outcomes: Promise<unknown>[] = [repair];
            void repair.catch(() => {});
            try {
                await withDeadline(paused.promise, 5_000, "repair did not lock the branch");
                const service = makeUserService(withHooks(handle.service, {
                    beforeTransaction: async (tx) => { await tx.$executeRaw`SET LOCAL deadlock_timeout = '50ms'`; },
                    onTransactionError: (error) => { errors.push(error); },
                }));
                const mutation = action === "reject" ? service.reject(old.id, actor) : service.approve(old.id, {
                    role: "admin", approvedBy: approver.id, branchId: branch.id, ownerBranchId: unowned.id, actor,
                });
                outcomes.push(mutation);
                void mutation.catch(() => {});
                // The admission transaction holds user FOR UPDATE and waits for
                // repair's branch. Repair's FK check then closes the lock cycle.
                await waitUntilBlocked(handle.raw, action === "reject" ? /UPDATE "public"\."branch"/ : /INSERT INTO "public"\."user_branch"/);
            } finally {
                release.resolve();
                await Promise.allSettled(outcomes);
            }
            expect(errors.some(isTransactionConflict)).toBe(true);
            expectSuccessOrConflict(await Promise.allSettled(outcomes));
            const admission = (await Promise.allSettled(outcomes))[1];
            const audits = await handle.raw.admin_audit_event.count({ where: {
                targetId: old.id, action: action === "reject" ? "user.rejected" : "branch.owner_assigned",
            } });
            expect(audits).toBe(admission?.status === "fulfilled" ? 1 : 0);
        });
    }

    for (const action of ["reject", "approve"] as const) {
        invariant("SI-USER-13", `${action}: real raw-query meta 40P01 conflicts exhaust three attempts as a clean 409`, async () => {
            const target = await user("1");
            const approver = await user("9", "owner");
            const actor = ownerActor(approver.id);
            const errors: unknown[] = [];
            const service = makeUserService(withHooks(handle.service, {
                beforeTransaction: async (tx) => {
                    // PostgreSQL, not a mocked Prisma error, supplies P2010.meta.code.
                    await tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'forced conflict' USING ERRCODE = '40P01'; END $$`;
                },
                onTransactionError: (error) => {
                    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
                    if (error instanceof Prisma.PrismaClientKnownRequestError) {
                        // Keep PostgreSQL's actual Prisma metadata, but simulate a
                        // generic wrapper message so the message regex cannot pass
                        // this test in place of metadata traversal.
                        error.message = "Raw query failed; SQLSTATE is available only in metadata";
                    }
                    errors.push(error);
                },
            }));
            const operation = action === "reject" ? service.reject(target.id, actor) : service.approve(target.id, {
                role: "user", approvedBy: approver.id, branchId: randomUUID(), actor,
            });
            await expect(operation).rejects.toMatchObject({
                status: 409, response: { code: "REQUEST_CONFLICT" },
            });
            expect(errors).toHaveLength(3);
            expect(errors[0]).toMatchObject({ code: "P2010", meta: { code: "40P01" } });
            expect(await handle.raw.user.findUniqueOrThrow({ where: { id: target.id }, select: { approvalStatus: true } }))
                .toEqual({ approvalStatus: "approved" });
        });
    }

    invariant("SI-USER-13", "system-admin refuses an owner changed while waiting with 409 and no audit", async () => {
        const old = await user("1");
        const next = await user("2");
        const branch = await ownedBranch(old.id);
        const actor = ownerActor((await user("9", "owner")).id);
        const locked = signal();
        const release = signal();
        const writer = handle.raw.$transaction(async (tx) => {
            await tx.branch.update({ where: { id: branch.id }, data: { ownerId: next.id } });
            locked.resolve();
            await release.promise;
        }, { timeout: 15_000 });
        const outcomes: Promise<unknown>[] = [writer];
        void writer.catch(() => {});
        try {
            await withDeadline(locked.promise, 5_000, "owner writer did not lock branch");
            const challenger = makeSystemAdminService(handle.service).updateBranch(branch.id, { name: "must not apply" }, actor);
            outcomes.push(challenger);
            void challenger.catch(() => {});
            await waitUntilBlocked(handle.raw, /FROM\s+"branch"[\s\S]*FOR\s+UPDATE/);
        } finally {
            release.resolve();
            await Promise.allSettled(outcomes);
        }
        expect(await Promise.allSettled(outcomes)).toEqual([
            expect.objectContaining({ status: "fulfilled" }),
            expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ status: 409, response: expect.objectContaining({ code: "REQUEST_CONFLICT" }) }) }),
        ]);
        expect(await handle.raw.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { name: true, ownerId: true } }))
            .toEqual({ name: branch.name, ownerId: next.id });
        expect(await handle.raw.admin_audit_event.count({ where: { targetId: branch.id } })).toBe(0);
    });

    invariant("SI-USER-12", "account assignment locks the old owner before branches when racing an owner transfer", async () => {
        const old = await user("1");
        const next = await user("2", "user");
        const branch = await ownedBranch(old.id);
        const actor = ownerActor((await user("9", "owner")).id);
        const paused = signal();
        const release = signal();
        const assignmentLocks: string[] = [];
        const assignment = makeUserService(withHooks(handle.service, {
            afterLock: async (query) => {
                assignmentLocks.push(`${query.text.includes('FROM "user"') ? "user" : "branch"}:${query.values[0]}`);
                if (assignmentLocks.length === 1) { paused.resolve(); await release.promise; }
            },
        })).updateAccountAssignment(old.id, {
            role: "manager", branchIds: [branch.id], expectedRole: "admin",
            expectedBranchIds: [branch.id], callerRole: "owner", actor,
        });
        const outcomes: Promise<unknown>[] = [assignment];
        void assignment.catch(() => {});
        try {
            await withDeadline(paused.promise, 5_000, "assignment did not acquire its first lock");
            const transfer = makeSystemAdminService(handle.service).updateBranch(branch.id, { ownerId: next.id }, actor);
            outcomes.push(transfer);
            void transfer.catch(() => {});
            await waitUntilBlocked(handle.raw, /FROM\s+"(?:user|branch)"[\s\S]*FOR\s+UPDATE/);
            release.resolve();
            expectSuccessOrConflict(await Promise.allSettled(outcomes));
        } finally {
            release.resolve();
            // The transfer must also settle before fixture cleanup on a failed wait.
            await Promise.allSettled(outcomes);
        }
        expect(assignmentLocks.slice(0, 2)).toEqual([`user:${old.id}`, `branch:${branch.id}`]);
        const persisted = await handle.raw.branch.findUniqueOrThrow({ where: { id: branch.id } });
        expect([null, next.id]).toContain(persisted.ownerId);
        expect(await handle.raw.user.findUniqueOrThrow({ where: { id: old.id }, select: { role: true } }))
            .toEqual({ role: "manager" });
    });

    invariant("SI-USER-12", "legacy owner membership repair versus branch update resolves the FK lock inversion without a raw deadlock", async () => {
        const old = await user("1");
        // Deliberately omit user_branch: the upsert CREATE must check the user FK.
        const branch = await createBranch(handle.raw, tracker, { ownerId: old.id });
        const actor = ownerActor((await user("9", "owner")).id);
        const paused = signal();
        const release = signal();
        const transactionErrors: unknown[] = [];
        let firstBranchLock = true;
        const membership = makeUserService(withHooks(handle.service, {
            afterLock: async () => {
                if (firstBranchLock) {
                    firstBranchLock = false;
                    paused.resolve();
                    await release.promise;
                }
            },
            onTransactionError: (error) => { transactionErrors.push(error); },
        })).update(old.id, { branchId: branch.id, branchRole: "admin", actor });
        const outcomes: Promise<unknown>[] = [membership];
        void membership.catch(() => {});
        try {
            await withDeadline(paused.promise, 5_000, "membership did not lock the branch");
            const update = makeSystemAdminService(withHooks(handle.service, {
                onTransactionError: (error) => { transactionErrors.push(error); },
            })).updateBranch(branch.id, { name: "legacy owner repair race" }, actor);
            outcomes.push(update);
            void update.catch(() => {});
            // updateBranch now holds the user's FOR UPDATE lock while waiting
            // for the branch. Releasing the upsert forces FOR KEY SHARE on user.
            await waitUntilBlocked(handle.raw, /FROM\s+"branch"[\s\S]*FOR\s+UPDATE/);
        } finally {
            release.resolve();
            await Promise.allSettled(outcomes);
        }
        expectSuccessOrConflict(await Promise.allSettled(outcomes));
        // Settle the reviewer's question with a real PostgreSQL error, not timing.
        expect(transactionErrors.some((error) => /40P01|deadlock/i.test(String(error)))).toBe(true);
        expect(await handle.raw.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { ownerId: true } }))
            .toEqual({ ownerId: old.id });
        expect(await handle.raw.user_branch.findUniqueOrThrow({
            where: { userId_branchId: { userId: old.id, branchId: branch.id } }, select: { role: true },
        })).toEqual({ role: "admin" });
    });

    invariant("SI-USER-12", "concurrent transfers of an admin's last two branches demote the global role to user", async () => {
        const old = await user("1");
        const nextA = await user("2", "user");
        const nextB = await user("3", "user");
        const a = await ownedBranch(old.id);
        const b = await ownedBranch(old.id);
        const actor = ownerActor((await user("9", "owner")).id);
        const paused = signal();
        const release = signal();
        let secondRead = false;
        const winner = makeSystemAdminService(withHooks(handle.service, {
            afterOwnershipRead: async () => { paused.resolve(); await release.promise; },
        })).updateBranch(a.id, { ownerId: nextA.id }, actor);
        const outcomes = [winner];
        // Attach rejection handlers immediately; never leave a mutation's failed
        // transaction running into fixture cleanup.
        const settled = winner.catch((error: unknown) => error);
        try {
            await withDeadline(paused.promise, 5_000, "first transfer did not reach ownership read");
            const challenger = makeSystemAdminService(withHooks(handle.service, {
                afterOwnershipRead: async () => { secondRead = true; },
            })).updateBranch(b.id, { ownerId: nextB.id }, actor);
            outcomes.push(challenger);
            void challenger.catch(() => {});
            await waitForChallenger(() => secondRead);
        } finally {
            release.resolve();
            await settled;
            await Promise.allSettled(outcomes);
        }
        expect(await Promise.allSettled(outcomes)).toEqual([
            expect.objectContaining({ status: "fulfilled" }),
            expect.objectContaining({ status: "fulfilled" }),
        ]);
        expect(await handle.raw.branch.count({ where: { ownerId: old.id } })).toBe(0);
        expect(await handle.raw.user_branch.findMany({ where: { userId: old.id }, select: { role: true } }))
            .toEqual([{ role: "user" }, { role: "user" }]);
        expect(await handle.raw.user.findUniqueOrThrow({ where: { id: old.id }, select: { role: true } }))
            .toEqual({ role: "user" });
    });

    invariant("SI-USER-12", "crossed ownership swaps finish without a surfaced deadlock using sorted users before branches", async () => {
        const u = await user("1");
        const v = await user("2");
        const a = await ownedBranch(u.id);
        const b = await ownedBranch(v.id);
        const actor = ownerActor((await user("9", "owner")).id);
        const paused = signal();
        const release = signal();
        let secondFirstLock = false;
        const firstLocks: string[] = [];
        const secondLocks: string[] = [];
        const winner = makeSystemAdminService(withHooks(handle.service, {
            afterLock: async (query) => {
                firstLocks.push(`${query.text.includes('FROM "user"') ? "user" : "branch"}:${query.values[0]}`);
                if (firstLocks.length === 1) { paused.resolve(); await release.promise; }
            },
        })).updateBranch(a.id, { ownerId: v.id }, actor);
        const outcomes = [winner];
        void winner.catch(() => {});
        try {
            await withDeadline(paused.promise, 5_000, "first swap did not acquire its first lock");
            const challenger = makeSystemAdminService(withHooks(handle.service, {
                afterLock: async (query) => {
                    secondLocks.push(`${query.text.includes('FROM "user"') ? "user" : "branch"}:${query.values[0]}`);
                    secondFirstLock = true;
                    if (secondLocks.length === 1) await release.promise;
                },
            })).updateBranch(b.id, { ownerId: u.id }, actor);
            outcomes.push(challenger);
            void challenger.catch(() => {});
            await waitForChallenger(() => secondFirstLock);
        } finally {
            release.resolve();
            await Promise.allSettled(outcomes);
        }
        expect(await Promise.allSettled(outcomes)).toEqual([
            expect.objectContaining({ status: "fulfilled" }),
            expect.objectContaining({ status: "fulfilled" }),
        ]);
        expect(firstLocks).toEqual([`user:${u.id}`, `user:${v.id}`, `branch:${a.id}`]);
        expect(secondLocks).toEqual([`user:${u.id}`, `user:${v.id}`, `branch:${b.id}`]);
        expect(await handle.raw.branch.findUniqueOrThrow({ where: { id: a.id }, select: { ownerId: true } }))
            .toEqual({ ownerId: v.id });
        expect(await handle.raw.branch.findUniqueOrThrow({ where: { id: b.id }, select: { ownerId: true } }))
            .toEqual({ ownerId: u.id });
        expect(await handle.raw.user.findMany({ where: { id: { in: [u.id, v.id] } }, select: { role: true } }))
            .toEqual([{ role: "admin" }, { role: "admin" }]);
    });
});
