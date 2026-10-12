import { NotFoundException } from "@nestjs/common";
import { BranchUserController } from "interface/controllers/branch-user.controller";
import { UserEntity } from "domain/entities/user.entity";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant";

/**
 * 권한-02a (BJJ-436): an owner account is invisible to every caller who is not an owner.
 * The branch-user routes answer the same RESOURCE_NOT_FOUND the DELETE route already gave,
 * decided on the authenticated principal's current global role.
 */
describe("BranchUserController owner invisibility (BJJ-436)", () => {
    const branchId = "branch-1";

    const entity = (id: string, role: string): UserEntity =>
        UserEntity.reconstitute(id, "kakao-" + id, id + "@example.com", id, null, role, new Date("2026-01-01"), null, false, null, "email");

    const tenant = (globalRole: string): VerifiedTenantPrincipal => ({
        userId: "caller-1",
        branchId,
        globalRole,
        branchRole: "admin",
    }) as VerifiedTenantPrincipal;

    let userService: { findById: jest.Mock; update: jest.Mock; delete: jest.Mock };
    let controller: BranchUserController;

    beforeEach(() => {
        userService = { findById: jest.fn(), update: jest.fn(), delete: jest.fn() };
        controller = new BranchUserController(userService as never);
    });

    describe("GET /branches/:branchId/users/:userId", () => {
        it.each(["admin", "manager", "user"])("answers not-found for an owner target when the caller is %s", async (callerRole) => {
            userService.findById.mockResolvedValue(entity("owner-1", "owner"));

            await expect(controller.findById(branchId, "owner-1", tenant(callerRole)))
                .rejects.toBeInstanceOf(NotFoundException);
        });

        it("returns the same body as a missing user (does not reveal the account exists)", async () => {
            userService.findById.mockResolvedValue(entity("owner-1", "owner"));
            const hidden = await controller.findById(branchId, "owner-1", tenant("admin")).catch((e: NotFoundException) => e);
            userService.findById.mockResolvedValue(null);
            const missing = await controller.findById(branchId, "ghost", tenant("admin")).catch((e: NotFoundException) => e);

            expect(hidden).toBeInstanceOf(NotFoundException);
            expect((hidden as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
        });

        it("still returns an owner target to an owner caller", async () => {
            userService.findById.mockResolvedValue(entity("owner-1", "owner"));

            const result = await controller.findById(branchId, "owner-1", tenant("owner"));

            expect(result).toMatchObject({ id: "owner-1", role: "owner" });
        });

        it("still returns a non-owner target to an admin caller", async () => {
            userService.findById.mockResolvedValue(entity("user-2", "manager"));

            const result = await controller.findById(branchId, "user-2", tenant("admin"));

            expect(result).toMatchObject({ id: "user-2", role: "manager" });
        });
    });

    describe("PATCH /branches/:branchId/users/:userId", () => {
        it("hands the authenticated caller's current global role to the service, which hides owner targets", async () => {
            userService.update.mockResolvedValue(entity("user-2", "manager"));

            await controller.update(branchId, "user-2", tenant("admin"), { branchRole: "manager" } as never);

            expect(userService.update).toHaveBeenCalledWith("user-2", {
                branchRole: "manager",
                callerRole: "admin",
                branchId,
            });
        });

        it("propagates the service's not-found for an owner target (no body of the owner is returned)", async () => {
            userService.update.mockRejectedValue(new NotFoundException());

            await expect(controller.update(branchId, "owner-1", tenant("admin"), { branchRole: "admin" } as never))
                .rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
