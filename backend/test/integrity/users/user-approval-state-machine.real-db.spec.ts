import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { createAuthSession, createBranch, createUser } from "../helpers/factories";
import { knownDefect, invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

import { makeUserService, ownerActor } from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";

/**
 * SI-USER-01 / SI-USER-02: the approval state machine.
 *
 * `UserService.approve` (application/services/user.service.ts ~1108) and
 * `UserService.reject` (~1275) run entirely on the caller's authority: neither
 * reads the target's CURRENT `approvalStatus` as a precondition before writing.
 * The correct invariant for both is that the destructive/privilege-granting
 * transition is only reachable from the state the transitions were designed
 * for — `reject` only from `pending`, `approve` only from `pending` — and that
 * any other source state is refused with the stored state left untouched.
 *
 * Real UserService + real AdminAuditEventWriter over the real database; the
 * five unused CRUD usecases are inert stubs exactly as in
 * test/services/user.service.spec.ts. Both specs are expected to FAIL today
 * (the writes succeed from the wrong source state), so they are `knownDefect`s
 * whose `expectedFailure` names the recorded violation.
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

    knownDefect(
        "SI-USER-01",
        "reject refuses a non-pending user instead of stripping an approved account",
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

            let refused: unknown;
            try {
                await service.reject(approved.id, actor);
            } catch (error) {
                refused = error;
            }
            if (refused !== undefined) {
                // The guard exists today: this knownDefect body would be green, so
                // the wrapper reports RED and the call must flip to invariant().
                throw new Error(
                    `SI-USER-01 wrong-reason failure: reject refused an approved user: ${
                        refused instanceof Error ? refused.message : String(refused)
                    }`,
                );
            }

            const after = await handle.raw.user.findUniqueOrThrow({ where: { id: approved.id } });
            const membershipCount = await handle.raw.user_branch.count({ where: { userId: approved.id } });
            const sessionAfter = await handle.raw.auth_session.findUniqueOrThrow({ where: { id: session.id } });
            if (
                after.approvalStatus === "approved"
                && membershipCount === 1
                && sessionAfter.revokedAt === null
            ) {
                // Reject ran but changed nothing observable — a wiring failure, not the defect.
                throw new Error(
                    "SI-USER-01 wrong-reason failure: reject succeeded but the approved account kept its memberships, status and session",
                );
            }

            throw new Error(
                `SI-USER-01: reject succeeded from approvalStatus='approved': status now '${after.approvalStatus}', ` +
                    `${1 - membershipCount} membership row(s) deleted, session ${session.id} revokedAt=${String(sessionAfter.revokedAt)} ` +
                    `(reason ${String(sessionAfter.revokedReason)})`,
            );
        },
        "SI-USER-01: reject succeeded from approvalStatus='approved'",
    );

    knownDefect(
        "SI-USER-02",
        "approve refuses a non-pending user instead of re-granting the role",
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

            let summary: { role: string | null; approvalStatus: string; tokenVersion: number } | undefined;
            try {
                summary = await service.approve(rejected.id, {
                    role: "manager",
                    approvedBy: owner.id,
                    branchId: branch.id,
                    actor,
                });
            } catch (error) {
                throw new Error(
                    `SI-USER-02 wrong-reason failure: approve refused a rejected user: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }

            const after = await handle.raw.user.findUniqueOrThrow({ where: { id: rejected.id } });
            const membershipCount = await handle.raw.user_branch.count({ where: { userId: rejected.id } });
            if (after.approvalStatus === "rejected" && membershipCount === 0) {
                throw new Error(
                    "SI-USER-02 wrong-reason failure: approve succeeded but the rejected account was not resurrected",
                );
            }

            // The audit event written for the re-approval records `before.approvalStatus`
            // as the hardcoded literal "pending" even though the true source state was
            // "rejected" — the authority trail now misdescribes the transition.
            const auditEvent = await handle.raw.admin_audit_event.findFirst({
                where: { action: "user.approved", targetId: rejected.id },
                orderBy: { createdAt: "desc" },
            });
            const beforePayload = auditEvent?.beforePayload as { approvalStatus?: string } | null | undefined;

            throw new Error(
                `SI-USER-02: approve succeeded from approvalStatus='rejected': status now '${after.approvalStatus}', ` +
                    `role null->'${String(after.role)}' (summary role '${String(summary?.role)}'), ` +
                    `tokenVersion ${after.tokenVersion}, ${membershipCount} membership row(s) created, ` +
                    `audit beforePayload.approvalStatus='${String(beforePayload?.approvalStatus)}' (actual source state was 'rejected')`,
            );
        },
        "SI-USER-02: approve succeeded from approvalStatus='rejected'",
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
