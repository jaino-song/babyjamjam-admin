import { Prisma } from "@prisma/client";

import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { createAuthSession, createBranch, createUser } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

import {
    makeUserService,
    ownerActor,
    waitUntilBlocked,
    withDeadline,
} from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";
import type { AdminAuditActor } from "application/services/admin-audit-event.service";

/**
 * The approval state machine in `UserService.approve` / `UserService.reject`
 * (application/services/user.service.ts), on the real database with the real
 * service + real AdminAuditEventWriter (the five unused CRUD usecases are inert
 * stubs exactly as in test/services/user.service.spec.ts).
 *
 * - SI-USER-01 (intended, operator decision 2026-10-31): `reject` has no precondition on the
 *   target's current `approvalStatus` — rejecting an APPROVED user succeeds and
 *   strips memberships/ownership/sessions in one call. Review evidence says the
 *   reject-from-approved path is intended (commit c31ed52f2 added
 *   membership/ownership removal on reject; the audit event records the prior
 *   status; user.service.spec.ts:1753+ rejects an approved owner-of-branch
 *   manager on purpose), so the test PINS today's reachable behaviour as an
 *   invariant instead of claiming a defect.
 * - SI-USER-02 (intended, operator decision 2026-10-31): `approve` has no check that the target
 *   is pending — approving a REJECTED user resurrects the account and re-grants
 *   the role. Same reasoning: pinned as a reachable-today invariant.
 * - SI-USER-09: `approve` locks and reads the target before writing, refusing
 *   owner/self targets so approval cannot bypass the last-owner invariant.
 * - SI-USER-10: the approval audit records the target's real prior role/status.
 */
describeReal("user approval state machine (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let service: ReturnType<typeof makeUserService>;

    beforeAll(async () => {
        handle = await createIntegrityPrisma();
        service = makeUserService(handle.service);
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

    /** Actor for an approved owner; the "approving owner's own branch" fixture. */
    async function createOwnerPair(): Promise<{ ownerA: Awaited<ReturnType<typeof createUser>>; ownerB: Awaited<ReturnType<typeof createUser>>; actor: AdminAuditActor; branch: Awaited<ReturnType<typeof createBranch>> }> {
        const branch = await createBranch(handle.raw, tracker);
        const ownerA = await createUser(handle.raw, tracker, { role: "owner" });
        const ownerB = await createUser(handle.raw, tracker, { role: "owner" });
        return { ownerA, ownerB, actor: ownerActor(ownerA.id), branch };
    }

    invariant(
        "SI-USER-01",
        "rejecting an already-APPROVED account strips memberships and sessions — intended (operator decision 2026-10-31)",
        async () => {
            const branch = await createBranch(handle.raw, tracker);
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const actor = ownerActor(owner.id);
            const approved = await createUser(
                handle.raw,
                tracker,
                { role: "user", approvalStatus: "approved" },
                { membership: { branchId: branch.id } },
            );
            const { session } = await createAuthSession(
                handle.raw,
                tracker,
                { userId: approved.id },
                { selectedBranchId: branch.id },
            );

            // Intended offboarding transition (operator decision 2026-10-31):
            // approved accounts may be rejected, removing memberships/sessions.
            await expect(service.reject(approved.id, actor)).resolves.toMatchObject({
                approvalStatus: "rejected",
            });

            const membershipCount = await handle.raw.user_branch.count({ where: { userId: approved.id } });
            const sessionAfter = await handle.raw.auth_session.findUniqueOrThrow({ where: { id: session.id } });
            expect(membershipCount).toBe(0);
            expect(sessionAfter.revokedAt).not.toBeNull();
            expect(sessionAfter.revokedReason).toBe("approval_rejected");
            const after = await handle.raw.user.findUniqueOrThrow({ where: { id: approved.id } });
            expect(after.approvalStatus).toBe("rejected");
        },
    );

    invariant(
        "SI-USER-02",
        "approving a REJECTED account resurrects it and re-grants the role — intended (operator decision 2026-10-31)",
        async () => {
            const branch = await createBranch(handle.raw, tracker);
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const actor = ownerActor(owner.id);
            // A previously REJECTED sign-up: role null, requested role recorded, no membership.
            const rejected = await createUser(handle.raw, tracker, {
                role: null,
                approvalStatus: "rejected",
                requestedRole: "manager",
            });

            // Intended restoration transition (operator decision 2026-10-31):
            // rejected accounts remain eligible for approval.
            await expect(service.approve(rejected.id, {
                role: "manager",
                approvedBy: owner.id,
                branchId: branch.id,
                actor,
            })).resolves.toMatchObject({
                role: "manager",
                approvalStatus: "approved",
            });

            const after = await handle.raw.user.findUniqueOrThrow({ where: { id: rejected.id } });
            const membershipCount = await handle.raw.user_branch.count({ where: { userId: rejected.id } });
            expect(after.approvalStatus).toBe("approved");
            expect(after.role).toBe("manager");
            expect(membershipCount).toBe(1);
        },
    );

    invariant(
        "SI-USER-09",
        "approve refuses an owner target and the caller's own account, and the owner count never reaches zero",
        async () => {
            const { ownerA, ownerB, actor, branch } = await createOwnerPair();
            // Per-test cleanup, not cross-test demotion, gives exactly these owners.
            // A leaked fixture must fail setup, never become expected defect evidence.
            expect(await handle.raw.user.count({ where: { role: "owner" } })).toBe(2);

            // Both calls must refuse with ACCESS_DENIED, without changing either
            // owner. Collect successful writes so the invariant fails only for
            // the demonstrated authorization gap, never for a setup/DB error.
            const violations: string[] = [];
            try {
                await service.approve(ownerB.id, {
                    role: "user",
                    approvedBy: ownerA.id,
                    branchId: branch.id,
                    actor,
                });
                violations.push("owner-target approval succeeded");
            } catch (error) {
                expect(error).toMatchObject({ status: 403, response: { code: "ACCESS_DENIED" } });
            }
            const ownerBAfter = await handle.raw.user.findUniqueOrThrow({ where: { id: ownerB.id } });
            if (ownerBAfter.role !== "owner") violations.push(`ownerB role became '${ownerBAfter.role}'`);

            // Part 2: the caller approves THEIR OWN account, re-granting a role on
            // the caller's own row. This must not bypass the deleteGlobalUser
            // last-owner guard (권한-02: at least one owner must survive).
            try {
                await service.approve(ownerA.id, {
                    role: "manager",
                    approvedBy: ownerA.id,
                    branchId: branch.id,
                    actor,
                });
                violations.push("self approval succeeded");
            } catch (error) {
                expect(error).toMatchObject({ status: 403, response: { code: "ACCESS_DENIED" } });
            }

            const ownerAAfter = await handle.raw.user.findUniqueOrThrow({ where: { id: ownerA.id } });
            if (ownerAAfter.role !== "owner") violations.push(`ownerA role became '${ownerAAfter.role}'`);
            const ownersLeft = await handle.raw.user.count({ where: { role: "owner" } });
            if (ownersLeft !== 2) violations.push(`owner count went 2 -> ${ownersLeft}`);
            if (violations.length > 0) {
                throw new Error(`SI-USER-09: approval authorization invariant violated: ${violations.join("; ")}`);
            }
        },
    );

    invariant(
        "SI-USER-09",
        "approve waits for the user-row lock and refuses a target concurrently promoted to owner",
        async () => {
            const branch = await createBranch(handle.raw, tracker);
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const target = await createUser(handle.raw, tracker, { role: "user" });
            let approval: Promise<{ error?: unknown }> | undefined;
            let outcome: { error?: unknown } | undefined;

            try {
                await handle.raw.$transaction(async (tx) => {
                    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${target.id}::uuid FOR UPDATE`);
                    await tx.user.update({ where: { id: target.id }, data: { role: "owner" } });
                    approval = service.approve(target.id, {
                        role: "user", approvedBy: owner.id, actor: ownerActor(owner.id), branchId: branch.id,
                    }).then(() => ({}), (error: unknown) => ({ error }));

                    // An UPDATE waiter is not enough: approval must lock BEFORE reading.
                    await waitUntilBlocked(handle.raw, /FROM\s+"user"[\s\S]*FOR\s+UPDATE/);
                }, { timeout: 15_000 });
            } finally {
                // Also drain the contender after a failed lock assertion/rollback.
                if (approval) outcome = await withDeadline(approval, 10_000, "approval contender did not settle");
            }

            expect(outcome).toMatchObject({ error: { status: 403, response: { code: "ACCESS_DENIED" } } });
            expect(await handle.raw.user.findUniqueOrThrow({ where: { id: target.id } }))
                .toMatchObject({ role: "owner", tokenVersion: target.tokenVersion });
            expect(await handle.raw.user_branch.count({ where: { userId: target.id } })).toBe(0);
        },
    );

    invariant(
        "SI-USER-09",
        "approve refuses an actor's own non-owner target even when approvedBy is a different owner",
        async () => {
            const branch = await createBranch(handle.raw, tracker);
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const target = await createUser(handle.raw, tracker, { role: "user" });

            await expect(service.approve(target.id, {
                role: "manager",
                approvedBy: owner.id,
                actor: { userId: target.id, globalRole: "user" },
                branchId: branch.id,
            })).rejects.toMatchObject({ status: 403, response: { code: "ACCESS_DENIED" } });

            expect(await handle.raw.user.findUniqueOrThrow({ where: { id: target.id } }))
                .toMatchObject({ role: target.role, approvalStatus: target.approvalStatus, tokenVersion: target.tokenVersion });
            expect(await handle.raw.user_branch.count({ where: { userId: target.id } })).toBe(0);
            expect(await handle.raw.admin_audit_event.count({ where: { targetId: target.id } })).toBe(0);
        },
    );

    invariant(
        "SI-USER-10",
        "the approval audit's before.approvalStatus records the real prior status of the target",
        async () => {
            const branch = await createBranch(handle.raw, tracker);
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const actor = ownerActor(owner.id);
            // The reachability of approve-from-rejected is pinned by the SI-USER-02
            // invariant above; the defect HERE is only the audit trail: the `before`
            // payload is hardcoded to the fresh-sign-up state instead of the ACTUAL
            // pre-transition state.
            const rejected = await createUser(handle.raw, tracker, {
                role: null,
                approvalStatus: "rejected",
                requestedRole: "manager",
            });

            try {
                await service.approve(rejected.id, {
                    role: "manager",
                    approvedBy: owner.id,
                    branchId: branch.id,
                    actor,
                });
            } catch (error) {
                throw new Error(
                    `SI-USER-10 wrong-reason failure: the pinned reachable transition was refused: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }

            const auditEvent = await handle.raw.admin_audit_event.findFirst({
                where: { action: "user.approved", targetId: rejected.id },
                orderBy: { createdAt: "desc" },
            });
            if (!auditEvent) {
                throw new Error("SI-USER-10 wrong-reason failure: no user.approved audit event was written");
            }
            const beforePayload = auditEvent.beforePayload as { approvalStatus?: string; role?: unknown } | null | undefined;
            expect(beforePayload?.role).toBe(rejected.role);

            // The correct invariant: the audit `before` must equal the target's real
            // pre-transition state ({ role: null, approvalStatus: "rejected" }).
            if (beforePayload?.approvalStatus === "rejected") {
                return;
            }

            throw new Error(
                `SI-USER-10: the user.approved audit event's before.approvalStatus is ` +
                    `'${String(beforePayload?.approvalStatus)}' (before.role '${String(beforePayload?.role)}') ` +
                    "but the target's real pre-transition state was approvalStatus='rejected', role=null — " +
                    "the before payload is hardcoded to the fresh-sign-up state, so the audit trail " +
                    "misdescribes non-pending approval transitions",
            );
        },
    );

    invariant(
        "SI-USER-10",
        "the approval audit records a non-null prior role when re-approving an approved account",
        async () => {
            const branch = await createBranch(handle.raw, tracker);
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const target = await createUser(handle.raw, tracker, { role: "manager", approvalStatus: "approved" });

            await service.approve(target.id, {
                role: "user", approvedBy: owner.id, actor: ownerActor(owner.id), branchId: branch.id,
            });

            const event = await handle.raw.admin_audit_event.findFirstOrThrow({
                where: { action: "user.approved", targetId: target.id },
            });
            expect(event.beforePayload).toEqual({ id: target.id, role: "manager", approvalStatus: "approved" });
            expect(event.afterPayload).toMatchObject({ id: target.id, role: "user", approvalStatus: "approved" });
        },
    );

    invariant(
        "SI-USER-01",
        "control: reject still refuses the global owner account (existing guard stays green)",
        async () => {
            const owner = await createUser(handle.raw, tracker, { role: "owner" });
            const actor = ownerActor(owner.id);
            await expect(service.reject(owner.id, actor)).rejects.toMatchObject({
                response: { code: "ACCESS_DENIED" },
            });
            const after = await handle.raw.user.findUniqueOrThrow({ where: { id: owner.id } });
            expect(after.approvalStatus).toBe("approved");
        },
    );
});
