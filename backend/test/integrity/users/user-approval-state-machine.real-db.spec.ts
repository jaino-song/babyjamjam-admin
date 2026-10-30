import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { createAuthSession, createBranch, createUser } from "../helpers/factories";
import { knownDefect, invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

import {
    isolateExactTwoOwnerWorld,
    makeUserService,
    ownerActor,
} from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";
import type { AdminAuditActor } from "application/services/admin-audit-event.service";

/**
 * The approval state machine in `UserService.approve` / `UserService.reject`
 * (application/services/user.service.ts), on the real database with the real
 * service + real AdminAuditEventWriter (the five unused CRUD usecases are inert
 * stubs exactly as in test/services/user.service.spec.ts).
 *
 * - SI-USER-01 (NEEDS-PRODUCT-DECISION): `reject` has no precondition on the
 *   target's current `approvalStatus` — rejecting an APPROVED user succeeds and
 *   strips memberships/ownership/sessions in one call. Review evidence says the
 *   reject-from-approved path is intended (commit c31ed52f2 added
 *   membership/ownership removal on reject; the audit event records the prior
 *   status; user.service.spec.ts:1753+ rejects an approved owner-of-branch
 *   manager on purpose), so the test PINS today's reachable behaviour as an
 *   invariant instead of claiming a defect.
 * - SI-USER-02 (NEEDS-PRODUCT-DECISION): `approve` has no check that the target
 *   is pending — approving a REJECTED user resurrects the account and re-grants
 *   the role. Same reasoning: pinned as a reachable-today invariant.
 * - SI-USER-09 (CONFIRMED, missed CRITICAL product defect): `approve` never
 *   reads the target before writing and enforces none of the guards `reject`
 *   enforces — approve of an OWNER target demotes them, approve of the CALLER'S
 *   OWN account self-demotes; combined, the owner count reaches 0, which
 *   bypasses the `deleteGlobalUser` last-owner guard (권한-02). knownDefect.
 * - SI-USER-10 (CONFIRMED): the approval audit's `before` payload hardcodes
 *   `{ role: null, approvalStatus: "pending" }` (user.service.ts) even when the
 *   real prior state was different, so the audit trail misdescribes the
 *   transition it records. knownDefect.
 */
describeReal("user approval state machine (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let service: ReturnType<typeof makeUserService>;

    beforeAll(async () => {
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        service = makeUserService(handle.service);
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
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
        "rejecting an already-APPROVED account strips memberships and sessions — is reachable today (NEEDS-PRODUCT-DECISION)",
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

            // Today's reachable behaviour, pinned as an invariant: reject has no
            // precondition on the source approvalStatus, so this succeeds and its
            // destructive writes run (memberships deleted, sessions revoked). The
            // product decision is whether the state machine gains a precondition
            // (`reject` only from `pending`) or a separate explicit deactivate
            // path; whichever is decided changes this invariant, not a defect id.
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
        "approving a REJECTED account resurrects it and re-grants the role — is reachable today (NEEDS-PRODUCT-DECISION)",
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

            // Today's reachable behaviour, pinned as an invariant: approve never
            // checks the target's approvalStatus, so the rejected account is
            // resurrected exactly as a pending sign-up would be. The product
            // decision is whether approve-from-rejected stays reachable; evidence
            // for the currently intended shape lives in commit c31ed52f2, the
            // audit event prior-status payload and user.service.spec.ts:1753+,
            // but the UI only offers approve for pending users.
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

    knownDefect(
        "SI-USER-09",
        "approve refuses an owner target and the caller's own account, and the owner count never reaches zero",
        async () => {
            const { ownerA, ownerB, actor, branch } = await createOwnerPair();
            // isolation: the suite's own earlier tests leave owner-role actor rows
            // (and earlier runs may have leaked rows); the owner-count evidence is
            // only valid in a world that starts with EXACTLY these two owners.
            await isolateExactTwoOwnerWorld(handle.raw, ownerA.id, ownerB.id);

            // Both calls must refuse with ACCESS_DENIED, without changing either
            // owner. Collect successful writes so the knownDefect fails only for
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
            // the caller's own row — no self guard exists in approve (reject has
            // one). Global owners drop to 0, bypassing the deleteGlobalUser
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
        "SI-USER-09: approval authorization invariant violated:",
    );

    knownDefect(
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

            // The correct invariant: the audit `before` must equal the target's real
            // pre-transition state ({ role: null, approvalStatus: "rejected" }).
            if (beforePayload?.approvalStatus === "rejected") {
                return; // invariant holds (fix landed): flip this knownDefect to invariant().
            }

            throw new Error(
                `SI-USER-10: the user.approved audit event's before.approvalStatus is ` +
                    `'${String(beforePayload?.approvalStatus)}' (before.role '${String(beforePayload?.role)}') ` +
                    "but the target's real pre-transition state was approvalStatus='rejected', role=null — " +
                    "the before payload is hardcoded to the fresh-sign-up state, so the audit trail " +
                    "misdescribes non-pending approval transitions",
            );
        },
        "SI-USER-10: the user.approved audit event's before.approvalStatus is 'pending'",
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
