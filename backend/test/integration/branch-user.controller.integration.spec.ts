import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    INestApplication,
    NotFoundException,
    ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { BranchUserController } from "interface/controllers/branch-user.controller";
import { UserEntity } from "domain/entities/user.entity";
import { UserService } from "application/services/user.service";
import { currentAdminAuditActor } from "application/services/admin-audit-context";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

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
        it("hands the authenticated caller as the actor to the service, which hides owner targets", async () => {
            userService.update.mockResolvedValue(entity("user-2", "manager"));

            await controller.update(branchId, "user-2", tenant("admin"), { branchRole: "manager" } as never);

            expect(userService.update).toHaveBeenCalledWith("user-2", {
                branchRole: "manager",
                branchId,
                actor: { userId: "caller-1", globalRole: "admin", branchRole: "admin" },
            });
        });

        it("hands an owner caller's role to the service for an owner target and returns the public user", async () => {
            userService.update.mockResolvedValue(entity("owner-1", "owner"));

            const result = await controller.update(branchId, "owner-1", tenant("owner"), { branchRole: "admin" } as never);

            expect(userService.update).toHaveBeenCalledWith("owner-1", {
                branchRole: "admin",
                branchId,
                actor: { userId: "caller-1", globalRole: "owner", branchRole: "admin" },
            });
            expect(result).toMatchObject({ id: "owner-1", role: "owner" });
        });

        it("propagates the service's not-found for an owner target (no body of the owner is returned)", async () => {
            userService.update.mockRejectedValue(new NotFoundException());

            await expect(controller.update(branchId, "owner-1", tenant("admin"), { branchRole: "admin" } as never))
                .rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe("DELETE /branches/:branchId/users/:userId", () => {
        it("hands the authenticated caller to the service as the actor", async () => {
            userService.findById.mockResolvedValue(entity("user-2", "user"));
            userService.delete.mockResolvedValue(undefined);

            const result = await controller.delete(branchId, "user-2", tenant("admin"));

            expect(result).toEqual({ success: true });
            expect(userService.delete).toHaveBeenCalledWith("user-2", branchId, {
                userId: "caller-1",
                globalRole: "admin",
                branchRole: "admin",
            });
        });

        it("runs the service inside the audit-actor context", async () => {
            userService.findById.mockResolvedValue(entity("user-2", "user"));
            let ambientActor: unknown;
            userService.delete.mockImplementation(async () => {
                ambientActor = currentAdminAuditActor();
            });

            await controller.delete(branchId, "user-2", tenant("admin"));

            expect(ambientActor).toEqual({ userId: "caller-1", globalRole: "admin", branchRole: "admin" });
        });
    });
});

/**
 * 권한-04 (BJJ-435): PATCH / DELETE are reachable by every role BranchManagerGuard admits
 * (owner, 지점장, 매니저); the service, not the route, decides which target and role the
 * caller may touch. GET keeps the owner / 지점장 guard.
 */
describe("BranchUserController guards (BJJ-435)", () => {
    const BRANCH = "branch-1";
    let app: INestApplication;
    let membershipRole: string | null;
    let globalRole: string;
    let userService: { findById: jest.Mock; update: jest.Mock; delete: jest.Mock };

    const jwtGuard: CanActivate = {
        canActivate(context: ExecutionContext): boolean {
            context.switchToHttp().getRequest().user = { userId: "caller-1", role: globalRole, branchId: BRANCH };
            return true;
        },
    };

    const asCaller = (branchRole: "owner" | "admin" | "manager" | "user"): void => {
        globalRole = branchRole === "owner" ? "owner" : "user";
        membershipRole = branchRole === "owner" ? null : branchRole;
    };

    beforeEach(async () => {
        globalRole = "user";
        membershipRole = null;
        userService = {
            findById: jest.fn().mockResolvedValue(
                UserEntity.reconstitute("user-2", "kakao-2", "u2@example.com", "u2", null, "user", new Date("2026-01-01"), null, false, null, "email"),
            ),
            update: jest.fn().mockResolvedValue(
                UserEntity.reconstitute("user-2", "kakao-2", "u2@example.com", "u2", null, "user", new Date("2026-01-01"), null, false, null, "email"),
            ),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        const moduleFixture = await Test.createTestingModule({
            controllers: [BranchUserController],
            providers: [
                TenantGuard,
                TenantContext,
                BranchManagerGuard,
                {
                    provide: PrismaService,
                    useValue: {
                        branch: { findUnique: jest.fn().mockResolvedValue({ id: BRANCH, isActive: true }) },
                        user_branch: {
                            findFirst: jest.fn().mockImplementation(async () =>
                                membershipRole ? { role: membershipRole, branch: { isActive: true } } : null),
                        },
                    },
                },
                { provide: UserService, useValue: userService },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(jwtGuard)
            .compile();
        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it.each(["owner", "admin", "manager"] as const)("admits %s to PATCH and DELETE and leaves the decision to the service", async (role) => {
        asCaller(role);

        await request(app.getHttpServer()).patch(`/branches/${BRANCH}/users/user-2`).send({ branchRole: "user" }).expect(200);
        await request(app.getHttpServer()).delete(`/branches/${BRANCH}/users/user-2`).expect(200);

        expect(userService.update).toHaveBeenCalledTimes(1);
        expect(userService.delete).toHaveBeenCalledTimes(1);
        expect(userService.update.mock.calls[0]?.[1]).toMatchObject({
            branchId: BRANCH,
            branchRole: "user",
            actor: { userId: "caller-1", branchRole: role === "owner" ? "owner" : role },
        });
    });

    it("refuses a 회원 caller at the guard before the service is reached", async () => {
        asCaller("user");

        await request(app.getHttpServer()).patch(`/branches/${BRANCH}/users/user-2`).send({ branchRole: "user" }).expect(403);
        await request(app.getHttpServer()).delete(`/branches/${BRANCH}/users/user-2`).expect(403);

        expect(userService.update).not.toHaveBeenCalled();
        expect(userService.delete).not.toHaveBeenCalled();
    });

    it("lets the service's refusal of a rank violation reach the client as 403", async () => {
        asCaller("manager");
        userService.update.mockRejectedValue(new ForbiddenException());
        userService.delete.mockRejectedValue(new ForbiddenException());

        await request(app.getHttpServer()).patch(`/branches/${BRANCH}/users/user-2`).send({ branchRole: "manager" }).expect(403);
        await request(app.getHttpServer()).delete(`/branches/${BRANCH}/users/user-2`).expect(403);
    });

    it("keeps GET owner / 지점장 only (a 매니저 is refused at the guard)", async () => {
        asCaller("manager");
        await request(app.getHttpServer()).get(`/branches/${BRANCH}/users/user-2`).expect(403);

        asCaller("admin");
        await request(app.getHttpServer()).get(`/branches/${BRANCH}/users/user-2`).expect(200);
    });
});
