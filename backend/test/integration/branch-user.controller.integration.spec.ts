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
        await app.listen(0, "127.0.0.1");
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

/**
 * 권한-04 (BJJ-435): DELETE (and PATCH) must re-check the caller before they answer anything
 * about the target. The controller is wired to the REAL UserService here, with a root client
 * and a distinct transaction client, so a target lookup that happens outside the transaction
 * (owner target -> 404, missing target -> 404) would show up as a non-403 for a caller whose
 * authority lapsed after the guard.
 */
describe("BranchUserController re-checks the caller before answering about the target (BJJ-435)", () => {
    const BRANCH = "branch-1";
    const stale = { userId: "caller-1", branchId: BRANCH, globalRole: "admin", branchRole: "admin" } as VerifiedTenantPrincipal;
    const ownerTenant = { ...stale, globalRole: "owner" } as VerifiedTenantPrincipal;

    const ids = { ordinary: "target-1", owner: "target-owner", missing: "target-ghost" } as const;
    type Kind = keyof typeof ids;
    const kinds: Kind[] = ["ordinary", "owner", "missing"];

    const entityFor = (id: string, role: string): UserEntity =>
        UserEntity.reconstitute(id, "kakao-" + id, id + "@example.com", id, null, role, new Date("2026-01-01"), null, false, null, "email");

    interface Caller {
        /** Global role of the caller row (null = no row). */
        global: string | null;
        /** Branch membership role of the caller (null = no row). */
        membership: string | null;
    }

    /** A Prisma-like read that returns only the columns the query selects. */
    const projected = (row: Record<string, unknown>) =>
        async ({ select }: { select?: Record<string, boolean> }) =>
            select
                ? Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key]) => [key, row[key]]))
                : row;

    const makeClient = (caller: Caller, branchActive = true) => ({
        branch: { findUnique: jest.fn().mockImplementation(projected({ id: BRANCH, ownerId: null, isActive: branchActive })) },
        user: {
            findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
                if (where.id === "caller-1") return caller.global === null ? null : { id: "caller-1", role: caller.global };
                if (where.id === ids.owner) return { id: where.id, name: "오너", role: "owner", approvalStatus: "approved" };
                if (where.id === ids.missing) return null;
                return { id: where.id, name: "대상", role: "user", approvalStatus: "approved" };
            }),
        },
        user_branch: {
            findUnique: jest.fn().mockImplementation(async ({ where }: { where: { userId_branchId: { userId: string } } }) => {
                const role = where.userId_branchId.userId === "caller-1" ? caller.membership : "user";
                return role === null ? null : { role };
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        auth_session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        $queryRaw: jest.fn().mockResolvedValue([]),
    });

    let controller: BranchUserController;
    let rootClient: ReturnType<typeof makeClient>;
    let txClient: ReturnType<typeof makeClient>;
    let auditAppend: jest.Mock;

    /** `active` says whether each client sees the branch as ACTIVE (default: both do). */
    const build = (root: Caller, tx: Caller, active: { root?: boolean; tx?: boolean } = {}): void => {
        rootClient = makeClient(root, active.root ?? true);
        txClient = makeClient(tx, active.tx ?? true);
        auditAppend = jest.fn().mockResolvedValue(undefined);
        const prisma = { ...rootClient, $transaction: jest.fn(async (cb: (c: unknown) => unknown) => cb(txClient)) };
        // The target lookup a controller could make before the transaction: it sees the
        // owner as an owner and the ghost as missing, exactly as the tables above do.
        const findUserById = {
            execute: jest.fn(async (id: string) =>
                id === ids.missing ? null : entityFor(id, id === ids.owner ? "owner" : "user")),
        };
        const service = new UserService(
            {} as never,
            findUserById as never,
            {} as never,
            {} as never,
            {} as never,
            prisma as never,
            { append: auditAppend } as never,
        );
        controller = new BranchUserController(service);
    };

    const expectNothingWritten = (): void => {
        for (const client of [rootClient, txClient]) {
            expect(client.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(client.user_branch.updateMany).not.toHaveBeenCalled();
            expect(client.user_branch.upsert).not.toHaveBeenCalled();
            expect(client.auth_session.updateMany).not.toHaveBeenCalled();
        }
    };

    const statusOf = async (run: () => Promise<unknown>): Promise<number | "ok"> => {
        try {
            await run();
            return "ok";
        } catch (error) {
            return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
        }
    };

    const del = (kind: Kind, tenant = stale) => statusOf(() => controller.delete(BRANCH, ids[kind], tenant));
    const patch = (kind: Kind, tenant = stale) =>
        statusOf(() => controller.update(BRANCH, ids[kind], tenant, { branchRole: "user" } as never));

    describe.each([
        ["demoted to 회원 at transaction time", { global: "user", membership: "user" }],
        ["without any membership row at transaction time", { global: "user", membership: null }],
        ["whose account row vanished at transaction time", { global: null, membership: null }],
    ] as const)("a caller %s (the guard and token still say 지점장)", (_label, txCaller) => {
        beforeEach(() => build({ global: "user", membership: "admin" }, txCaller));

        it("DELETE answers 403 for an ordinary, an owner and a missing target alike", async () => {
            expect(await Promise.all(kinds.map((kind) => del(kind)))).toEqual([403, 403, 403]);
            expectNothingWritten();
        });

        it("PATCH answers 403 for an ordinary, an owner and a missing target alike", async () => {
            expect(await Promise.all(kinds.map((kind) => patch(kind)))).toEqual([403, 403, 403]);
            expectNothingWritten();
        });
    });

    describe("a still-authorized 매니저", () => {
        beforeEach(() => build({ global: "user", membership: "manager" }, { global: "user", membership: "manager" }));

        it("DELETE: ordinary target removed, owner target 404, missing target 404", async () => {
            expect(await Promise.all(kinds.map((kind) => del(kind)))).toEqual(["ok", 404, 404]);
            expect(txClient.user_branch.deleteMany).toHaveBeenCalledTimes(1);
            expect(txClient.user_branch.deleteMany).toHaveBeenCalledWith({ where: { userId: ids.ordinary, branchId: BRANCH } });
        });

        it("PATCH: ordinary target changed, owner target 404, missing target 404", async () => {
            expect(await Promise.all(kinds.map((kind) => patch(kind)))).toEqual(["ok", 404, 404]);
        });
    });

    describe("an owner caller", () => {
        beforeEach(() => {
            build({ global: "owner", membership: null }, { global: "owner", membership: null });
            // A ghost id has no membership row to remove.
            txClient.user_branch.deleteMany.mockImplementation(async ({ where }: { where: { userId: string } }) => ({
                count: where.userId === ids.missing ? 0 : 1,
            }));
        });

        it("DELETE: ordinary and owner targets removed, missing target 404 (same codes as before)", async () => {
            expect(await Promise.all(kinds.map((kind) => del(kind, ownerTenant)))).toEqual(["ok", "ok", 404]);
        });
    });

    /** Ids the transaction client was asked about, via `user.findUnique`. */
    const lookedUpUserIds = (): string[] =>
        txClient.user.findUnique.mock.calls.map(([args]: [{ where: { id: string } }]) => args.where.id);

    const notFoundBody = async (run: () => Promise<unknown>): Promise<unknown> => {
        try {
            await run();
            return undefined;
        } catch (error) {
            return (error as { getResponse?: () => unknown }).getResponse?.();
        }
    };

    describe("a branch deactivated after the guard admitted the request (the transaction sees it INACTIVE)", () => {
        describe.each([
            ["a 지점장", { global: "user", membership: "admin" }, stale],
            ["a 매니저", { global: "user", membership: "manager" }, stale],
            ["an owner", { global: "owner", membership: null }, ownerTenant],
        ] as const)("caller still authorized as %s", (_label, authority, tenant) => {
            beforeEach(() => build(authority, authority, { root: true, tx: false }));

            it("DELETE answers 404, with no target lookup, no write, no session revocation and no audit", async () => {
                expect(await del("ordinary", tenant)).toBe(404);

                expect(await notFoundBody(() => controller.delete(BRANCH, ids.ordinary, tenant)))
                    .toMatchObject({ code: "RESOURCE_NOT_FOUND" });
                expect(lookedUpUserIds().filter((id) => id !== "caller-1")).toEqual([]);
                expectNothingWritten();
                expect(auditAppend).not.toHaveBeenCalled();
            });
        });

        describe.each([
            ["demoted to 회원", { global: "user", membership: "user" }],
            ["without any membership row", { global: "user", membership: null }],
            ["whose account row vanished", { global: null, membership: null }],
        ] as const)("a caller %s", (_label, txCaller) => {
            beforeEach(() => build({ global: "user", membership: "admin" }, txCaller, { root: true, tx: false }));

            it("DELETE answers 403 (not 404) for an ordinary, an owner and a missing target alike", async () => {
                expect(await Promise.all(kinds.map((kind) => del(kind)))).toEqual([403, 403, 403]);

                expect(lookedUpUserIds().filter((id) => id !== "caller-1")).toEqual([]);
                expectNothingWritten();
                expect(auditAppend).not.toHaveBeenCalled();
            });
        });
    });

    describe("an ACTIVE branch (the transaction sees it ACTIVE)", () => {
        it("reads the branch columns from the transaction client, not the root client", async () => {
            // The root client is told the branch is INACTIVE; only the transaction answer counts.
            build({ global: "user", membership: "admin" }, { global: "user", membership: "admin" }, { root: false, tx: true });

            expect(await del("ordinary")).toBe("ok");

            expect(txClient.branch.findUnique).toHaveBeenCalledWith({
                where: { id: BRANCH },
                select: { ownerId: true, isActive: true },
            });
            expect(rootClient.branch.findUnique).not.toHaveBeenCalled();
        });

        it.each([
            ["a 지점장", { global: "user", membership: "admin" }, stale],
            ["a 매니저", { global: "user", membership: "manager" }, stale],
            ["an owner", { global: "owner", membership: null }, ownerTenant],
        ] as const)("DELETE by %s removes the membership, revokes sessions and appends the audit", async (_label, authority, tenant) => {
            build(authority, authority);

            expect(await del("ordinary", tenant)).toBe("ok");

            expect(txClient.user_branch.deleteMany).toHaveBeenCalledWith({ where: { userId: ids.ordinary, branchId: BRANCH } });
            expect(txClient.auth_session.updateMany).toHaveBeenCalledWith({
                where: { userId: ids.ordinary, revokedAt: null },
                data: { revokedAt: expect.any(Date), revokedReason: "membership_deleted" },
            });
            expect(auditAppend).toHaveBeenCalledTimes(1);
            expect(auditAppend).toHaveBeenCalledWith(
                txClient,
                expect.objectContaining({ action: "user.membership.deleted", branchId: BRANCH }),
            );
        });
    });
});
