import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import { createAuthSession, createBranch, createUser } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

import {
    createKnownRefreshToken,
    decodeAccessToken,
    makeAuthSessionService,
    makeJwtStrategy,
    makeSystemAdminService,
    makeTenantGuard,
    makeUserService,
    ownerActor,
    tenantRequestContext,
} from "./users-local.helpers";

import type { IntegrityPrisma } from "../helpers/real-db";

/**
 * SI-USER-03 / SI-USER-04: whether the request-time and refresh-time re-evaluation
 * in `TenantGuard` (infrastructure/tenant/tenant.guard.ts) and `JwtStrategy`
 * (infrastructure/auth/jwt.strategy.ts) closes the gaps left by
 * `SystemAdminService.updateBranch` (application/services/system-admin.service.ts):
 *
 * - SI-USER-03: deactivating a branch neither revokes sessions nor bumps
 *   `tokenVersion`. The invariant that must still hold: after deactivation, the
 *   NEXT request carrying an existing access token for that branch is refused,
 *   and a refresh re-issues credentials WITHOUT the deactivated branch.
 * - SI-USER-04: transferring branch ownership demotes the old owner without
 *   session revocation. The invariant that must still hold: the demoted owner's
 *   existing token is evaluated with the FRESH database roles on the very next
 *   request (jwt.strategy fresh global role; TenantGuard fresh branch role), so
 *   the stale token cannot exercise the old authority.
 *
 * Real SystemAdminService / TenantGuard / JwtStrategy / AuthSessionService over
 * the real database. `signAsync` is stubbed to return the signed claims
 * (base64url JSON) so tests can assert exactly what a refresh would bake into a
 * new access token; the JWT secret for the strategy is a local test literal.
 */
describeReal("branch deactivation and owner transfer against live sessions (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    beforeAll(async () => {
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    /** A system-admin actor row; appendAudit requires an acting user id. */
    async function createSystemAdminActor() {
        return createUser(handle.raw, tracker, { role: "user", approvalStatus: "approved" });
    }

    invariant(
        "SI-USER-03",
        "after branch deactivation the next request with an existing token is refused and refresh drops the branch",
        async () => {
            const systemAdmin = makeSystemAdminService(handle.service);
            const { guard } = makeTenantGuard(handle.service);
            const authSession = makeAuthSessionService(handle.service);
            const actor = await createSystemAdminActor();

            // --- member path: a plain approved member with a live session on the branch ---
            const branch = await createBranch(handle.raw, tracker);
            const member = await createUser(
                handle.raw,
                tracker,
                { role: "user", approvalStatus: "approved" },
                { membership: { branchId: branch.id } },
            );
            const { session: memberSession } = await createAuthSession(
                handle.raw,
                tracker,
                { userId: member.id },
                { selectedBranchId: branch.id },
                { refreshToken: { activeMarker: null } },
            );
            const memberToken = await createKnownRefreshToken(handle.raw, tracker, memberSession.id);

            await systemAdmin.updateBranch(branch.id, { isActive: false }, ownerActor(actor.id));

            // The existing access token for the deactivated branch is refused per request.
            await expect(
                guard.canActivate(tenantRequestContext({
                    userId: member.id,
                    role: member.role,
                    branchId: branch.id,
                })),
            ).rejects.toBeInstanceOf(ForbiddenException);

            // Refresh keeps the (unrevoked) session alive but must NOT re-issue the
            // deactivated branch: the new access token carries no branchId and the
            // session's selectedBranchId is dropped.
            const rotated = await authSession.rotateRefreshToken(memberToken.rawToken);
            const claims = decodeAccessToken(rotated.accessToken);
            expect(claims["branchId"]).toBeUndefined();
            expect(claims["branchRole"]).toBeUndefined();
            const memberSessionAfter = await handle.raw.auth_session.findUniqueOrThrow({
                where: { id: memberSession.id },
            });
            expect(memberSessionAfter.revokedAt).toBeNull();
            expect(memberSessionAfter.selectedBranchId).toBeNull();

            // The PRE-deactivation token (claims still naming the branch) dies at the
            // very next request: the strategy compares the token's branchId against the
            // session's fresh selectedBranchId.
            const strategy = makeJwtStrategy(handle.service);
            await expect(strategy.validate({
                sub: member.id,
                sid: memberSession.id,
                role: "user",
                tokenVersion: member.tokenVersion,
                type: "access",
                branchId: branch.id,
            })).rejects.toBeInstanceOf(UnauthorizedException);

            // --- owner path: a global owner holding the branch is refused too ---
            const ownerBranch = await createBranch(handle.raw, tracker, { isActive: true });
            const branchOwner = await createUser(handle.raw, tracker, { role: "owner" });
            await handle.raw.branch.update({
                where: { id: ownerBranch.id },
                data: { ownerId: branchOwner.id },
            });
            const { session: ownerSession } = await createAuthSession(
                handle.raw, tracker, { userId: branchOwner.id }, { selectedBranchId: ownerBranch.id },
            );
            const ownerToken = {
                sub: branchOwner.id,
                sid: ownerSession.id,
                role: "owner",
                tokenVersion: branchOwner.tokenVersion,
                type: "access" as const,
                branchId: ownerBranch.id,
            };

            // Allowing control: BEFORE deactivation the same token's claims pass
            // JwtStrategy and TenantGuard (so the refusal below is deactivation's
            // effect, not a fixture artefact).
            await expect(
                guard.canActivate(tenantRequestContext(await strategy.validate(ownerToken))),
            ).resolves.toBe(true);

            await systemAdmin.updateBranch(ownerBranch.id, { isActive: false }, ownerActor(actor.id));

            await expect(
                guard.canActivate(tenantRequestContext(await strategy.validate(ownerToken))),
            ).rejects.toBeInstanceOf(ForbiddenException);

            // Cleanup order: clear ownership the tracker's fixed rank cannot express
            // (branch is deleted before its owner user).
            await handle.raw.branch.updateMany({
                where: { id: { in: [ownerBranch.id] } },
                data: { ownerId: null },
            });
        },
    );

    invariant(
        "SI-USER-04",
        "a demoted branch owner's existing token is evaluated with the fresh roles on the next request",
        async () => {
            const systemAdmin = makeSystemAdminService(handle.service);
            const { guard, context } = makeTenantGuard(handle.service);
            const strategy = makeJwtStrategy(handle.service);
            const actor = await createSystemAdminActor();

            const branch = await createBranch(handle.raw, tracker);
            const oldOwner = await createUser(
                handle.raw,
                tracker,
                { role: "admin", approvalStatus: "approved" },
                { membership: { branchId: branch.id, role: "admin" } },
            );
            const newOwner = await createUser(
                handle.raw,
                tracker,
                { role: "user", approvalStatus: "approved" },
                { membership: { branchId: branch.id } },
            );
            await handle.raw.branch.update({
                where: { id: branch.id },
                data: { ownerId: oldOwner.id },
            });
            const { session } = await createAuthSession(
                handle.raw,
                tracker,
                { userId: oldOwner.id },
                { selectedBranchId: branch.id },
            );

            // The token the old owner still holds, issued before the transfer.
            const oldTokenPayload = {
                sub: oldOwner.id,
                sid: session.id,
                role: "admin",
                tokenVersion: oldOwner.tokenVersion,
                type: "access",
                branchId: branch.id,
                branchRole: "admin",
            } as const;

            await systemAdmin.updateBranch(branch.id, { ownerId: newOwner.id }, ownerActor(actor.id));

            // jwt.strategy re-reads the GLOBAL role from the database instead of
            // trusting the token: the demoted owner's old token now validates as the
            // fresh (demoted) role.
            const principal = await strategy.validate(oldTokenPayload);
            expect(principal.role).toBe("user");

            // TenantGuard re-reads the membership role: the request principal gets the
            // fresh branch role "user", not the stale "admin" baked into the token.
            await expect(
                guard.canActivate(tenantRequestContext({
                    userId: oldOwner.id,
                    role: principal.role,
                    branchId: branch.id,
                })),
            ).resolves.toBe(true);
            expect(context.branchRole).toBe("user");
            expect(context.globalRole).toBe("user");

            // And the owner-only branch mutation itself refuses the demoted owner's
            // identity when re-read inside the write transaction (권한-04 caller
            // re-read): the demoted owner's branch rank no longer outranks anyone.
            const userService = makeUserService(handle.service);
            await expect(
                userService.update(newOwner.id, {
                    branchId: branch.id,
                    branchRole: "admin",
                    actor: { userId: oldOwner.id, globalRole: principal.role },
                }),
            ).rejects.toBeInstanceOf(ForbiddenException);

            // Cleanup order: clear ownership before the ranked deletes.
            await handle.raw.branch.update({ where: { id: branch.id }, data: { ownerId: null } });
        },
    );
});
