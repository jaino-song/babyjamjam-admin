import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { createBranch, createUser, createUserBranchMembership } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

import { makeSystemAdminService, ownerActor, sleep, withDeadline } from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";
import type { PrismaService } from "infrastructure/database/prisma.service";

function signal() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

// Keep real SQL and transaction boundaries; hooks only pause after real queries.
function withHooks(prisma: PrismaService, hooks: {
    afterLock?: (query: Prisma.Sql) => Promise<void>;
    afterOwnershipRead?: () => Promise<void>;
}): PrismaService {
    return new Proxy(prisma, {
        get(target, key) {
            if (key === "$transaction") {
                return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
                    target.$transaction((tx) => callback(new Proxy(tx, {
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
                    })), { timeout: 15_000 });
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
