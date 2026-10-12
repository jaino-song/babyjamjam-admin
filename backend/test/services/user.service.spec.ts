import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { UserService } from "../../application/services/user.service";
import {
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "../../application/usecases/user";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminAuditActor, AdminAuditEventWriter } from "../../application/services/admin-audit-event.service";

describe("UserService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockUsecase = () => ({ execute: jest.fn() });

    const createMockPrismaService = () => {
        const prisma = {
            user: {
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn(),
                update: jest.fn(),
            },
            branch: {
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn().mockResolvedValue({ id: "branch-1" }),
                update: jest.fn().mockResolvedValue({ id: "branch-1" }),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            user_branch: {
                upsert: jest.fn().mockResolvedValue({ id: "membership-1" }),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn().mockResolvedValue(null),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            auth_session: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            $queryRaw: jest.fn().mockResolvedValue([]),
            $transaction: jest.fn(),
        };
        prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
        return prisma;
    };

    let service: UserService;
    let createUserUsecase: ReturnType<typeof createMockUsecase>;
    let findUserByIdUsecase: ReturnType<typeof createMockUsecase>;
    let findUserByKakaoIdUsecase: ReturnType<typeof createMockUsecase>;
    let updateUserUsecase: ReturnType<typeof createMockUsecase>;
    let deleteUserUsecase: ReturnType<typeof createMockUsecase>;
    let prismaService: ReturnType<typeof createMockPrismaService>;

    // 권한-04: owner-only global writes and branch-membership writes re-read the caller
    // inside the transaction, so every such call needs an acting user.
    const ownerActor: AdminAuditActor = { userId: "owner-1", globalRole: "owner" };

    beforeEach(() => {
        createUserUsecase = createMockUsecase();
        findUserByIdUsecase = createMockUsecase();
        findUserByKakaoIdUsecase = createMockUsecase();
        updateUserUsecase = createMockUsecase();
        deleteUserUsecase = createMockUsecase();
        prismaService = createMockPrismaService();

        service = new UserService(
            createUserUsecase as unknown as CreateUserUsecase,
            findUserByIdUsecase as unknown as FindUserByIdUsecase,
            findUserByKakaoIdUsecase as unknown as FindUserByKakaoIdUsecase,
            updateUserUsecase as unknown as UpdateUserUsecase,
            deleteUserUsecase as unknown as DeleteUserUsecase,
            prismaService as unknown as PrismaService,
            { append: jest.fn().mockResolvedValue(undefined) } as unknown as AdminAuditEventWriter,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findDirectory
    // ============================================
    describe("findDirectory", () => {
        it("does not select or return sensitive identifiers", async () => {
            prismaService.user.findMany.mockResolvedValue([{
                id: "u1", kakaoId: "private-kakao", passwordHash: "private-hash", userBranches: [],
            }]);
            const result = await service.findDirectory();
            const select = prismaService.user.findMany.mock.calls[0][0].select;
            expect(select).not.toHaveProperty("kakaoId");
            expect(select).not.toHaveProperty("passwordHash");
            expect(result[0]).not.toHaveProperty("kakaoId");
            expect(result[0]).not.toHaveProperty("passwordHash");
        });
        it("revokes active sessions after deleting a branch membership", async () => {
            prismaService.branch.findUnique.mockResolvedValue({ id: "branch-1", ownerId: "other" });
            prismaService.user_branch.deleteMany.mockResolvedValue({ count: 1 });
            prismaService.user.findUnique.mockResolvedValue({ role: "owner" });
            await service.delete("u1", "branch-1", ownerActor);
            expect(prismaService.auth_session.updateMany).toHaveBeenCalledWith({
                where: { userId: "u1", revokedAt: null },
                data: { revokedAt: expect.any(Date), revokedReason: "membership_deleted" },
            });
            expect(prismaService.auth_session.updateMany.mock.invocationCallOrder[0])
                .toBeGreaterThan(prismaService.user_branch.deleteMany.mock.invocationCallOrder[0] ?? Infinity);
        });
        it("should query without a where clause when no filters are provided (owner caller)", async () => {
            await service.findDirectory({ callerRole: "owner" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: undefined }),
            );
        });

        it("should filter by approvalStatus when status is provided", async () => {
            await service.findDirectory({ status: "pending", callerRole: "owner" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { approvalStatus: "pending" },
                }),
            );
        });

        it("should combine branchId and status filters", async () => {
            await service.findDirectory({ branchId: "branch-1", status: "approved" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        approvalStatus: "approved",
                        OR: expect.any(Array),
                    }),
                }),
            );
        });

        it("should widen the branch filter to also match branch-less users when includeUnassigned is set (owner path)", async () => {
            await service.findDirectory({ branchId: "branch-1", includeUnassigned: true, callerRole: "owner" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [
                            { userBranches: { some: { branchId: "branch-1" } } },
                            { ownedBranches: { some: { id: "branch-1" } } },
                            { userBranches: { none: {} }, ownedBranches: { none: {} } },
                        ],
                    }),
                }),
            );
        });

        it("should keep the branch filter scoped to exactly the branch when includeUnassigned is not set (admin path, unchanged)", async () => {
            await service.findDirectory({ branchId: "branch-1" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [
                            { userBranches: { some: { branchId: "branch-1" } } },
                            { ownedBranches: { some: { id: "branch-1" } } },
                        ],
                    }),
                }),
            );
        });

        it("should apply no branch filter at all when includeUnassigned is set without a branchId (owner with no branch selected)", async () => {
            await service.findDirectory({ includeUnassigned: true, callerRole: "owner" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: undefined }),
            );
        });

        it("should keep applying the status filter alongside the widened owner branch filter", async () => {
            await service.findDirectory({ branchId: "branch-1", status: "pending", includeUnassigned: true, callerRole: "owner" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        approvalStatus: "pending",
                        OR: [
                            { userBranches: { some: { branchId: "branch-1" } } },
                            { ownedBranches: { some: { id: "branch-1" } } },
                            { userBranches: { none: {} }, ownedBranches: { none: {} } },
                        ],
                    }),
                }),
            );
        });

        describe("owner accounts are invisible to non-owner callers (권한-02a, BJJ-436)", () => {
            const ownerWhereGuard = { OR: [{ role: null }, { role: { not: "owner" } }] };
            const ownerRow = {
                id: "owner-user-id", email: "owner@example.com", name: "대표", phone: null, birthDate: null,
                profileImage: null, role: "owner", createdAt: new Date("2026-01-01"), emailVerified: true,
                authProvider: "email", approvalStatus: "approved", requestedRole: null,
                userBranches: [{ role: "admin", branch: { id: "branch-1", name: "본점" } }],
            };

            it.each(["admin", "manager", "user"])("excludes global-role owners from the query for a %s caller (branch-scoped)", async (callerRole) => {
                await service.findDirectory({ branchId: "branch-1", callerRole });

                const where = prismaService.user.findMany.mock.calls[0][0].where;
                // Branch scope is untouched: owners attached via ownedBranches AND owners that
                // are plain members are both removed by the same global-role predicate.
                expect(where.OR).toEqual([
                    { userBranches: { some: { branchId: "branch-1" } } },
                    { ownedBranches: { some: { id: "branch-1" } } },
                ]);
                expect(where.AND).toEqual([ownerWhereGuard]);
            });

            it("keeps role-less (null) users in scope instead of dropping them with the SQL NULL trap", async () => {
                await service.findDirectory({ branchId: "branch-1", callerRole: "admin" });

                const guard = prismaService.user.findMany.mock.calls[0][0].where.AND[0];
                expect(guard.OR).toContainEqual({ role: null });
            });

            it("applies the owner exclusion together with the status filter", async () => {
                await service.findDirectory({ branchId: "branch-1", status: "approved", callerRole: "admin" });

                expect(prismaService.user.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: expect.objectContaining({ approvalStatus: "approved", AND: [ownerWhereGuard] }),
                    }),
                );
            });

            it("fails closed: a missing caller role is treated as a non-owner", async () => {
                await service.findDirectory({ branchId: "branch-1" });
                await service.findDirectory();

                for (const call of prismaService.user.findMany.mock.calls) {
                    expect(call[0].where.AND).toEqual([ownerWhereGuard]);
                }
            });

            it("leaves the owner caller's query unfiltered (owners still list owners)", async () => {
                await service.findDirectory({ branchId: "branch-1", includeUnassigned: true, callerRole: "owner" });

                const where = prismaService.user.findMany.mock.calls[0][0].where;
                expect(where).not.toHaveProperty("AND");
                expect(where.OR).toHaveLength(3);
            });

            it("returns owner rows to an owner caller unchanged", async () => {
                prismaService.user.findMany.mockResolvedValue([ownerRow]);

                const result = await service.findDirectory({ branchId: "branch-1", callerRole: "owner" });

                expect(result).toHaveLength(1);
                expect(result[0]).toMatchObject({ id: "owner-user-id", role: "owner" });
            });
        });

        it("should include approvalStatus and requestedRole in the mapped result", async () => {
            prismaService.user.findMany.mockResolvedValue([
                {
                    id: "u1",
                    kakaoId: null,
                    email: "a@example.com",
                    name: "A",
                    phone: null,
                    birthDate: null,
                    profileImage: null,
                    role: null,
                    createdAt: new Date("2025-01-01"),
                    emailVerified: false,
                    authProvider: "email",
                    approvalStatus: "pending",
                    requestedRole: "admin",
                    ownedBranches: [],
                    userBranches: [],
                },
            ]);

            const result = await service.findDirectory();

            expect(result[0]).toEqual(
                expect.objectContaining({
                    approvalStatus: "pending",
                    requestedRole: "admin",
                }),
            );
        });

        it("should select approvalStatus and requestedRole from prisma", async () => {
            await service.findDirectory();

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    select: expect.objectContaining({
                        approvalStatus: true,
                        requestedRole: true,
                    }),
                }),
            );
        });

        it("should map branch roles from each user's membership without manager ownership overriding them", async () => {
            const sharedFields = {
                kakaoId: null,
                phone: "010-1234-5678",
                birthDate: null,
                profileImage: null,
                createdAt: new Date("2026-07-27"),
                emailVerified: true,
                authProvider: "email",
                approvalStatus: "approved",
                requestedRole: null,
            };

            prismaService.user.findMany.mockResolvedValue([
                {
                    ...sharedFields,
                    id: "owner-user-id",
                    email: "owner@example.com",
                    name: "송진호",
                    role: "owner",
                    ownedBranches: [],
                    userBranches: [
                        {
                            role: "admin",
                            branch: { id: "owner-branch-id", name: "인천 아이미래로" },
                        },
                    ],
                },
                {
                    ...sharedFields,
                    id: "manager-user-id",
                    email: "manager@example.com",
                    name: "송진호",
                    role: "admin",
                    ownedBranches: [
                        { id: "manager-branch-id", name: "인천 서구점" },
                    ],
                    userBranches: [
                        {
                            role: "admin",
                            branch: { id: "manager-branch-id", name: "인천 서구점" },
                        },
                    ],
                },
            ]);

            const result = await service.findDirectory({ callerRole: "owner" });

            expect(result).toEqual([
                expect.objectContaining({
                    id: "owner-user-id",
                    branches: [
                        expect.objectContaining({
                            id: "owner-branch-id",
                            role: "owner",
                        }),
                    ],
                }),
                expect.objectContaining({
                    id: "manager-user-id",
                    branches: [
                        expect.objectContaining({
                            id: "manager-branch-id",
                            role: "admin",
                        }),
                    ],
                }),
            ]);
        });
    });

    // ============================================
    // updateAccountAssignment
    // ============================================
    describe("updateAccountAssignment", () => {
        const branchIds: [string, string] = [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ];

        type AssignmentParams = Parameters<UserService["updateAccountAssignment"]>[1];

        const membership = (
            branchId: string,
            role: string = "admin",
            isActive: boolean = true,
        ) => ({
            branchId,
            role,
            branch: { isActive },
        });

        const approvedTarget = (overrides: Record<string, unknown> = {}) => ({
            id: "u1",
            name: "A",
            email: "a@example.com",
            role: "admin",
            approvalStatus: "approved",
            approvedAt: new Date("2026-07-13"),
            approvedBy: "owner-1",
            requestedRole: "admin",
            tokenVersion: 1,
            ownedBranches: [{ id: branchIds[0], isActive: true }],
            userBranches: branchIds.map((branchId) => membership(branchId)),
            ...overrides,
        });

        const assignmentParams = (
            overrides: Partial<AssignmentParams> = {},
        ): AssignmentParams => ({
            role: "manager",
            branchIds: [...branchIds],
            expectedRole: "admin",
            expectedBranchIds: [...branchIds],
            callerRole: "owner",
            actor: ownerActor,
            ...overrides,
        });

        const expectNoAssignmentWrites = () => {
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        };

        beforeEach(() => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget());
            // The first read inside the transaction is the caller's own row (권한-04).
            prismaService.user.findUnique.mockResolvedValueOnce({ role: "owner" });
            prismaService.branch.findMany.mockResolvedValue(
                branchIds.map((id) => ({ id })),
            );
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "manager",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "manager",
                tokenVersion: 2,
            });
        });

        it("replaces the exact branch membership set and demotes retained branch roles, then revokes active sessions", async () => {
            const result = await service.updateAccountAssignment(
                "u1",
                assignmentParams(),
            );

            expect(prismaService.$transaction).toHaveBeenCalledWith(
                expect.any(Function),
                { isolationLevel: "Serializable" },
            );
            expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
            const [lockQuery] = prismaService.$queryRaw.mock.calls[0] ?? [];
            expect(lockQuery.strings.join(" ")).toContain('SELECT "id" FROM "branch"');
            expect(lockQuery.strings.join(" ")).toMatch(/WHERE "id" =\s*::uuid FOR UPDATE/);
            expect(lockQuery.values).toEqual([branchIds[0]]);
            expect(prismaService.branch.findMany).toHaveBeenCalledWith({
                where: {
                    id: { in: branchIds },
                    isActive: true,
                },
                select: { id: true },
            });
            expect(prismaService.branch.updateMany).toHaveBeenCalledWith({
                where: { ownerId: "u1" },
                data: { ownerId: null },
            });
            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: {
                        role: "manager",
                        tokenVersion: { increment: 1 },
                    },
                }),
            );
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: { notIn: branchIds },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledTimes(2);
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, {
                where: {
                    userId_branchId: { userId: "u1", branchId: branchIds[0] },
                },
                update: { role: "manager" },
                create: { userId: "u1", branchId: branchIds[0], role: "manager" },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, {
                where: {
                    userId_branchId: { userId: "u1", branchId: branchIds[1] },
                },
                update: { role: "manager" },
                create: { userId: "u1", branchId: branchIds[1], role: "manager" },
            });
            expect(prismaService.auth_session.updateMany).toHaveBeenCalledWith({
                where: { userId: "u1", revokedAt: null },
                data: {
                    revokedAt: expect.any(Date),
                    revokedReason: "account_assignment_changed",
                },
            });
            expect(result).toEqual(expect.objectContaining({
                id: "u1",
                role: "manager",
                tokenVersion: 2,
            }));
        });

        it("caps every retained role above the selected global role during admin demotion", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                userBranches: [
                    membership(branchIds[0], "admin"),
                    membership(branchIds[1], "manager"),
                ],
            }));
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "user",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 2,
            });

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "user",
                    expectedRole: "admin",
                }),
            );

            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
                update: { role: "user" },
                create: expect.objectContaining({ role: "user" }),
            }));
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
                update: { role: "user" },
                create: expect.objectContaining({ role: "user" }),
            }));
        });

        it("preserves equal and lower retained roles during admin-to-manager demotion", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                userBranches: [
                    membership(branchIds[0], "admin"),
                    membership(branchIds[1], "user"),
                ],
            }));

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    expectedRole: "admin",
                }),
            );

            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
                update: { role: "manager" },
                create: expect.objectContaining({ role: "manager" }),
            }));
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
                update: { role: "user" },
                create: expect.objectContaining({ role: "user" }),
            }));
        });

        it("caps retained manager memberships when demoting a manager to user", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [
                    membership(branchIds[0], "manager"),
                    membership(branchIds[1], "user"),
                ],
            }));
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "user",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 2,
            });

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "user",
                    expectedRole: "manager",
                }),
            );

            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
                update: { role: "user" },
                create: expect.objectContaining({ role: "user" }),
            }));
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
                update: { role: "user" },
                create: expect.objectContaining({ role: "user" }),
            }));
            expect(prismaService.auth_session.updateMany).toHaveBeenCalled();
        });

        it("preserves lower retained branch roles during a promotion", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "user",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "user")],
            }));
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "manager",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 2,
            });

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [...branchIds],
                    expectedRole: "user",
                    expectedBranchIds: [branchIds[0]],
                }),
            );

            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
                update: { role: "user" },
                create: expect.objectContaining({ role: "user" }),
            }));
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
                update: { role: "manager" },
                create: expect.objectContaining({ role: "manager" }),
            }));
        });

        it("keeps a same-role assignment a no-op when retained branch roles are not above it", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [
                    membership(branchIds[0], "manager"),
                    membership(branchIds[1], "user"),
                ],
            }));
            prismaService.branch.findMany.mockResolvedValue([
                { id: branchIds[0] },
                { id: branchIds[1] },
            ]);

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [...branchIds],
                    expectedRole: "manager",
                    expectedBranchIds: [...branchIds],
                }),
            );

            expectNoAssignmentWrites();
        });

        it("preserves a deliberate above-global retained role when the global role is unchanged", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [
                    membership(branchIds[0], "admin"),
                    membership(branchIds[1], "user"),
                ],
            }));
            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [...branchIds],
                    expectedRole: "manager",
                    expectedBranchIds: [...branchIds],
                }),
            );

            expectNoAssignmentWrites();
        });

        it("returns 409 without writes when the expected role is stale", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "user")],
            }));

            const error = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "user",
                    expectedBranchIds: [branchIds[0]],
                }),
            ).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getStatus()).toBe(409);
            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expectNoAssignmentWrites();
        });

        it("returns 409 without writes when the expected branch set is stale", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));

            const error = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[1]],
                }),
            ).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getStatus()).toBe(409);
            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expectNoAssignmentWrites();
        });

        it("returns the current summary without writes or session revocation for an exact semantic no-op", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            const result = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0]],
                }),
            );

            expect(result).toEqual(expect.objectContaining({
                id: "u1",
                role: "manager",
                tokenVersion: 1,
            }));
            expectNoAssignmentWrites();
        });

        it("retries a serializable write conflict and then returns the successful result", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);
            prismaService.$transaction
                .mockRejectedValueOnce({ code: "P2034" })
                .mockImplementationOnce(async (callback) => callback(prismaService));

            const result = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0]],
                }),
            );

            expect(prismaService.$transaction).toHaveBeenCalledTimes(2);
            expect(result).toEqual(expect.objectContaining({
                id: "u1",
                role: "manager",
                tokenVersion: 1,
            }));
            expectNoAssignmentWrites();
        });

        it("maps an exhausted serializable write conflict to 409 without durable residue", async () => {
            prismaService.$transaction.mockRejectedValue({ code: "P2034" });

            const error = await service.updateAccountAssignment(
                "u1",
                assignmentParams(),
            ).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getStatus()).toBe(409);
            expect((error as ConflictException).getResponse()).toEqual(expect.objectContaining({
                code: "REQUEST_CONFLICT",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }));
            expect(prismaService.$transaction).toHaveBeenCalledTimes(3);
            expect(prismaService.user.findUnique).not.toHaveBeenCalled();
            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expectNoAssignmentWrites();
        });

        it("does not retry a non-conflict database failure", async () => {
            const databaseError = Object.assign(new Error("database unavailable"), {
                code: "P1001",
            });
            prismaService.$transaction.mockRejectedValue(databaseError);

            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams(),
            )).rejects.toBe(databaseError);

            expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
            expectNoAssignmentWrites();
        });

        it("refuses an unknown or inactive non-owned branch before any durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                userBranches: [membership(branchIds[0])],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds,
                    expectedBranchIds: [branchIds[0]],
                }),
            )).rejects.toMatchObject({
                status: 400,
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expectNoAssignmentWrites();
        });

        it("caps an existing inactive membership role when it exceeds the selected global role", async () => {
            const inactiveMembershipBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [
                    membership(branchIds[0], "manager"),
                    membership(inactiveMembershipBranchId, "manager", false),
                ],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0], inactiveMembershipBranchId],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0], inactiveMembershipBranchId],
                }),
            );

            expect(prismaService.branch.findMany).toHaveBeenCalledWith({
                where: {
                    id: { in: [branchIds[0]] },
                    isActive: true,
                },
                select: { id: true },
            });
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: {
                        notIn: [branchIds[0], inactiveMembershipBranchId],
                    },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith({
                where: {
                    userId_branchId: {
                        userId: "u1",
                        branchId: inactiveMembershipBranchId,
                    },
                },
                update: { role: "user" },
                create: {
                    userId: "u1",
                    branchId: inactiveMembershipBranchId,
                    role: "user",
                },
            });
        });

        it("preserves an omitted inactive owned branch while adding an active branch", async () => {
            const inactiveOwnedBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                ownedBranches: [{ id: inactiveOwnedBranchId, isActive: false }],
                userBranches: [membership(inactiveOwnedBranchId, "admin", false)],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "admin",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 2,
            });

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds: [branchIds[0]],
                    expectedBranchIds: [inactiveOwnedBranchId],
                }),
            );

            expect(prismaService.branch.findMany).toHaveBeenCalledWith({
                where: {
                    id: { in: [branchIds[0]] },
                    isActive: true,
                },
                select: { id: true },
            });
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: {
                        notIn: [branchIds[0], inactiveOwnedBranchId],
                    },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledTimes(2);
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, {
                where: {
                    userId_branchId: { userId: "u1", branchId: branchIds[0] },
                },
                update: { role: "admin" },
                create: { userId: "u1", branchId: branchIds[0], role: "admin" },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, {
                where: {
                    userId_branchId: { userId: "u1", branchId: inactiveOwnedBranchId },
                },
                update: { role: "admin" },
                create: { userId: "u1", branchId: inactiveOwnedBranchId, role: "admin" },
            });
        });

        it("refuses an inactive-owned-only admin membership set before any durable write", async () => {
            const inactiveOwnedBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                ownedBranches: [{ id: inactiveOwnedBranchId, isActive: false }],
                userBranches: [membership(inactiveOwnedBranchId, "admin", false)],
            }));

            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds: [inactiveOwnedBranchId],
                    expectedBranchIds: [inactiveOwnedBranchId],
                }),
            )).rejects.toMatchObject({
                status: 400,
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("drops an omitted inactive owned membership when demoting an admin", async () => {
            const inactiveOwnedBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                ownedBranches: [{ id: inactiveOwnedBranchId, isActive: false }],
                userBranches: [membership(inactiveOwnedBranchId, "admin", false)],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedBranchIds: [inactiveOwnedBranchId],
                }),
            );

            expect(prismaService.branch.updateMany).toHaveBeenCalledWith({
                where: { ownerId: "u1" },
                data: { ownerId: null },
            });
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: { notIn: [branchIds[0]] },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledTimes(1);
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        userId_branchId: {
                            userId: "u1",
                            branchId: inactiveOwnedBranchId,
                        },
                    },
                }),
            );
        });

        it("preserves an existing admin while changing memberships without clearing branch ownership", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                userBranches: [membership(branchIds[0])],
            }));
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "admin",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 2,
            });

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds,
                    expectedBranchIds: [branchIds[0]],
                }),
            );

            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: {
                        role: "admin",
                        tokenVersion: { increment: 1 },
                    },
                }),
            );
            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: { role: "admin" },
                    create: expect.objectContaining({ role: "admin" }),
                }),
            );
        });

        it("refuses escalating a non-admin target to admin before any durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "manager-target",
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));

            await expect(service.updateAccountAssignment(
                "manager-target",
                assignmentParams({
                    role: "admin",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0]],
                }),
            )).rejects.toMatchObject({
                status: 403,
                response: expect.objectContaining({
                    code: "ACCESS_DENIED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses removing an owned branch while retaining admin before any durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "admin-target",
                ownedBranches: branchIds.map((branchId) => ({
                    id: branchId,
                    isActive: true,
                })),
            }));

            await expect(service.updateAccountAssignment(
                "admin-target",
                assignmentParams({
                    role: "admin",
                    branchIds: [branchIds[0]],
                }),
            )).rejects.toMatchObject({
                status: 400,
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses owner targets before any branch lookup or durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "owner-target",
                role: "owner",
                ownedBranches: [],
            }));

            await expect(service.updateAccountAssignment(
                "owner-target",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0]],
                }),
            )).rejects.toMatchObject({
                status: 403,
                response: expect.objectContaining({
                    code: "ACCESS_DENIED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses non-approved targets before any branch lookup or durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "pending-target",
                role: null,
                approvalStatus: "pending",
                ownedBranches: [],
            }));

            await expect(service.updateAccountAssignment(
                "pending-target",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0]],
                }),
            )).rejects.toMatchObject({
                status: 400,
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses an approved target with an unknown global role before any durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "legacy-target",
                role: null,
                approvalStatus: "approved",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "admin")],
            }));

            await expect(service.updateAccountAssignment(
                "legacy-target",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0]],
                    expectedRole: "user",
                    expectedBranchIds: [branchIds[0]],
                }),
            )).rejects.toMatchObject({
                status: 409,
                response: expect.objectContaining({
                    code: "REQUEST_CONFLICT",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expectNoAssignmentWrites();
        });

        it("decides on the caller row re-read in the transaction, not on callerRole: a database non-owner is refused even when callerRole says owner", async () => {
            prismaService.user.findUnique.mockReset();
            prismaService.user.findUnique.mockResolvedValue(approvedTarget());
            prismaService.user.findUnique.mockResolvedValueOnce({ role: "admin" });

            const rejection = service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0]],
                    callerRole: "owner",
                }),
            );
            await expect(rejection).rejects.toBeInstanceOf(ForbiddenException);
            await expect(rejection).rejects.toMatchObject({
                status: 403,
                response: expect.objectContaining({
                    code: "ACCESS_DENIED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.user.findUnique).toHaveBeenCalledTimes(1);
            expect(prismaService.user.findUnique).toHaveBeenCalledWith({
                where: { id: "owner-1" },
                select: { role: true },
            });
            expectNoAssignmentWrites();
        });

        it("ignores callerRole: a database owner is allowed even when callerRole says user", async () => {
            const result = await service.updateAccountAssignment(
                "u1",
                assignmentParams({ callerRole: "user" }),
            );

            expect(result.id).toBe("u1");
            expect(prismaService.user.update).toHaveBeenCalledTimes(1);
        });

        it("answers a missing assignment target with a registered RESOURCE_NOT_FOUND body", async () => {
            prismaService.user.findUnique.mockResolvedValue(null);

            await expect(service.updateAccountAssignment(
                "missing-target",
                assignmentParams(),
            )).rejects.toMatchObject({
                status: 404,
                response: expect.objectContaining({
                    code: "RESOURCE_NOT_FOUND",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });
            expectNoAssignmentWrites();
        });

        it("maps branch-selection guards to VALIDATION_FAILED bodies with /branchIds pointers", async () => {
            prismaService.branch.findMany.mockResolvedValue([]);

            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams({ role: "user" }),
            )).rejects.toMatchObject({
                status: 400,
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    errors: [expect.objectContaining({ pointer: "/branchIds", code: "INVALID_VALUE" })],
                }),
            });
        });
    });

    // ============================================
    // approve
    // ============================================
    describe("approve", () => {
        beforeEach(() => {
            prismaService.user.findUnique.mockResolvedValue({ role: "owner" });
        });

        it("should approve a user in a single transaction, assigning role, approval metadata, and bumping tokenVersion", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "admin",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 1,
            });

            const result = await service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                actor: ownerActor,
                branchId: "branch-1",
                ownerBranchId: "branch-1",
            });

            expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: expect.objectContaining({
                        approvalStatus: "approved",
                        approvedBy: "owner-1",
                        role: "admin",
                        tokenVersion: { increment: 1 },
                    }),
                }),
            );
            expect(result.approvalStatus).toBe("approved");
            expect(result.approvedBy).toBe("owner-1");
            expect(result.role).toBe("admin");
            expect(result.tokenVersion).toBe(1);
        });

        it("should create or update the selected branch membership", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "approved",
                tokenVersion: 1,
            });
            prismaService.branch.findUnique.mockResolvedValue({ id: "branch-9" });

            await service.approve("u1", { role: "manager", approvedBy: "owner-1", actor: ownerActor, branchId: "branch-9" });

            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith({
                where: {
                    userId_branchId: { userId: "u1", branchId: "branch-9" },
                },
                update: { role: "manager" },
                create: { userId: "u1", branchId: "branch-9", role: "manager" },
            });
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    role: null,
                    branchId: { not: "branch-9" },
                },
            });
        });

        it("should reject approval when the selected branch does not exist", async () => {
            prismaService.branch.findUnique.mockResolvedValue(null);

            await expect(service.approve("u1", {
                role: "manager",
                approvedBy: "owner-1",
                actor: ownerActor,
                branchId: "missing-branch",
            })).rejects.toMatchObject({
                status: 400,
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
        });

        it("should assign branch ownership when approving role 'admin' with an ownerBranchId on a vacant branch", async () => {
            prismaService.branch.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
                if (where.id === "branch-1") return Promise.resolve({ id: "branch-1" });
                if (where.id === "owner-branch-1") {
                    return Promise.resolve({ id: "owner-branch-1", ownerId: null });
                }
                return Promise.resolve(null);
            });
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "approved",
                role: "admin",
                tokenVersion: 1,
            });

            await service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                actor: ownerActor,
                branchId: "branch-1",
                ownerBranchId: "owner-branch-1",
            });

            expect(prismaService.branch.update).toHaveBeenCalledWith({
                where: { id: "owner-branch-1" },
                data: { ownerId: "u1" },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        userId_branchId: { userId: "u1", branchId: "owner-branch-1" },
                    },
                    update: { role: "admin" },
                    create: { userId: "u1", branchId: "owner-branch-1", role: "admin" },
                }),
            );
        });

        it("should reject approving role 'admin' when the ownerBranchId already has an owner", async () => {
            prismaService.branch.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
                if (where.id === "branch-1") return Promise.resolve({ id: "branch-1" });
                if (where.id === "owner-branch-1") {
                    return Promise.resolve({ id: "owner-branch-1", ownerId: "existing-owner" });
                }
                return Promise.resolve(null);
            });

            await expect(service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                actor: ownerActor,
                branchId: "branch-1",
                ownerBranchId: "owner-branch-1",
            })).rejects.toMatchObject({
                status: 409,
                response: expect.objectContaining({
                    code: "REQUEST_CONFLICT",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.branch.update).not.toHaveBeenCalled();
        });

        it("should reject approving role 'admin' without an ownerBranchId", async () => {
            await expect(service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                actor: ownerActor,
                branchId: "branch-1",
            })).rejects.toMatchObject({
                status: 400,
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    params: {},
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.branch.update).not.toHaveBeenCalled();
        });

        it.each(["manager", "user"])(
            "should approve role '%s' without an ownerBranchId and without touching branch ownership",
            async (role) => {
                prismaService.user.update.mockResolvedValue({
                    id: "u1",
                    approvalStatus: "approved",
                    role,
                    tokenVersion: 1,
                });

                await service.approve("u1", {
                    role,
                    approvedBy: "owner-1",
                    actor: ownerActor,
                    branchId: "branch-1",
                });

                expect(prismaService.branch.update).not.toHaveBeenCalled();
            },
        );
    });

    // ============================================
    // reject
    // ============================================
    describe("reject", () => {
        beforeEach(() => {
            prismaService.user.findUnique.mockResolvedValue({ id: "u1", role: "manager" });
            // The first read inside the transaction is the caller's own row (권한-04).
            prismaService.user.findUnique.mockResolvedValueOnce({ role: "owner" });
        });

        it("should set approvalStatus to rejected and bump tokenVersion", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "rejected",
                tokenVersion: 1,
            });

            const result = await service.reject("u1", ownerActor);

            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: expect.objectContaining({
                        approvalStatus: "rejected",
                        tokenVersion: { increment: 1 },
                    }),
                }),
            );
            expect(result.approvalStatus).toBe("rejected");
        });

        it("deletes all branch memberships for the rejected user", async () => {
            prismaService.user.update.mockResolvedValue({ id: "u1", approvalStatus: "rejected", tokenVersion: 1 });
            prismaService.user_branch.findMany.mockResolvedValue([
                { branchId: "branch-1" },
                { branchId: "branch-2" },
            ]);

            await service.reject("u1", ownerActor);

            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
        });

        it("clears ownerId on every branch owned by the rejected user", async () => {
            prismaService.user.update.mockResolvedValue({ id: "u1", approvalStatus: "rejected", tokenVersion: 1 });
            prismaService.branch.findMany.mockResolvedValue([{ id: "owner-branch-1" }]);

            await service.reject("u1", ownerActor);

            expect(prismaService.branch.updateMany).toHaveBeenCalledWith({
                where: { ownerId: "u1" },
                data: { ownerId: null },
            });
        });

        it("still calls branch.updateMany unconditionally when the user owns no branch (closes the ownership-clear race)", async () => {
            prismaService.user.update.mockResolvedValue({ id: "u1", approvalStatus: "rejected", tokenVersion: 1 });
            prismaService.branch.findMany.mockResolvedValue([]);

            await service.reject("u1", ownerActor);

            // Must run unconditionally: a concurrent approve() that grants ownership
            // between the pre-lock read and this call would otherwise be skipped by
            // an `if (ownedBranches.length > 0)` guard gated on a stale read.
            expect(prismaService.branch.updateMany).toHaveBeenCalledWith({
                where: { ownerId: "u1" },
                data: { ownerId: null },
            });
        });

        it("locks the user row before reading role, approval status, memberships, and owned branches", async () => {
            prismaService.user.update.mockResolvedValue({ id: "u1", approvalStatus: "rejected", tokenVersion: 1 });

            await service.reject("u1", ownerActor);

            expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
            const [lockQuery] = prismaService.$queryRaw.mock.calls[0] ?? [];
            expect(lockQuery.strings.join(" ")).toContain('SELECT "id" FROM "user"');
            expect(lockQuery.values).toEqual(["u1"]);

            const lockOrder = prismaService.$queryRaw.mock.invocationCallOrder[0]!;
            const targetReadIndex = prismaService.user.findUnique.mock.calls
                .findIndex(([args]: [{ where: { id: string } }]) => args.where.id === "u1");
            expect(targetReadIndex).toBeGreaterThanOrEqual(0);
            expect(lockOrder).toBeLessThan(prismaService.user.findUnique.mock.invocationCallOrder[targetReadIndex]!);
            expect(lockOrder).toBeLessThan(prismaService.user_branch.findMany.mock.invocationCallOrder[0]!);
            expect(lockOrder).toBeLessThan(prismaService.branch.findMany.mock.invocationCallOrder[0]!);
        });

        it("records the removed branch ids and cleared owner branch ids in the audit event metadata", async () => {
            const auditWriter = { append: jest.fn().mockResolvedValue(undefined) };
            service = new UserService(
                createUserUsecase as unknown as CreateUserUsecase,
                findUserByIdUsecase as unknown as FindUserByIdUsecase,
                findUserByKakaoIdUsecase as unknown as FindUserByKakaoIdUsecase,
                updateUserUsecase as unknown as UpdateUserUsecase,
                deleteUserUsecase as unknown as DeleteUserUsecase,
                prismaService as unknown as PrismaService,
                auditWriter as unknown as AdminAuditEventWriter,
            );
            const actor: AdminAuditActor = { userId: "owner-1", globalRole: "owner" };
            prismaService.user.findUnique.mockResolvedValue({ id: "u1", role: "manager", approvalStatus: "approved" });
            prismaService.user.update.mockResolvedValue({ id: "u1", approvalStatus: "rejected", tokenVersion: 1 });
            prismaService.user_branch.findMany.mockResolvedValue([{ branchId: "branch-1", role: "admin", joinedAt: new Date("2026-01-01") }]);
            prismaService.branch.findMany.mockResolvedValue([{ id: "owner-branch-1" }]);

            await service.reject("u1", actor);

            expect(auditWriter.append).toHaveBeenCalledWith(
                prismaService,
                expect.objectContaining({
                    action: "user.rejected",
                    targetType: "user",
                    targetId: "u1",
                    actor,
                    outcome: "success",
                    before: {
                        id: "u1",
                        approvalStatus: "approved",
                        role: "manager",
                        memberships: [{ branchId: "branch-1", role: "admin" }],
                        ownedBranchIds: ["owner-branch-1"],
                    },
                    after: expect.objectContaining({
                        id: "u1",
                        approvalStatus: "rejected",
                        removedBranchIds: ["branch-1"],
                        clearedOwnerBranchIds: ["owner-branch-1"],
                    }),
                }),
            );
        });

        it("refuses to reject the acting user's own account", async () => {
            const actor: AdminAuditActor = { userId: "u1", globalRole: "owner" };

            await expect(service.reject("u1", actor)).rejects.toMatchObject({
                status: 403,
                response: expect.objectContaining({
                    code: "ACCESS_DENIED",
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
        });

        it("refuses to reject a user whose global role is 'owner'", async () => {
            prismaService.user.findUnique.mockResolvedValue({ id: "u2", role: "owner" });
            const actor: AdminAuditActor = { userId: "owner-1", globalRole: "owner" };

            await expect(service.reject("u2", actor)).rejects.toMatchObject({
                status: 403,
                response: expect.objectContaining({
                    code: "ACCESS_DENIED",
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
        });

        it("re-approving after a reject recreates branch membership", async () => {
            prismaService.user.update.mockResolvedValueOnce({ id: "u1", approvalStatus: "rejected", tokenVersion: 1 });
            prismaService.user_branch.findMany.mockResolvedValue([{ branchId: "branch-1" }]);
            prismaService.branch.findMany.mockResolvedValue([]);

            await service.reject("u1", ownerActor);
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });

            prismaService.user.update.mockResolvedValueOnce({
                id: "u1",
                approvalStatus: "approved",
                role: "manager",
                tokenVersion: 2,
            });
            prismaService.branch.findUnique.mockResolvedValue({ id: "branch-1" });
            prismaService.user.findUnique.mockResolvedValueOnce({ role: "owner" });

            await service.approve("u1", { role: "manager", approvedBy: "owner-1", actor: ownerActor, branchId: "branch-1" });

            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith({
                where: { userId_branchId: { userId: "u1", branchId: "branch-1" } },
                update: { role: "manager" },
                create: { userId: "u1", branchId: "branch-1", role: "manager" },
            });
        });
    });

    // ============================================
    // update / updateGlobalUser (role-change gate + audit)
    // ============================================
    describe("update (global role changes)", () => {
        let auditWriter: { append: jest.Mock };
        const actor: AdminAuditActor = { userId: "owner-1", globalRole: "owner" };

        beforeEach(() => {
            auditWriter = { append: jest.fn().mockResolvedValue(undefined) };
            service = new UserService(
                createUserUsecase as unknown as CreateUserUsecase,
                findUserByIdUsecase as unknown as FindUserByIdUsecase,
                findUserByKakaoIdUsecase as unknown as FindUserByKakaoIdUsecase,
                updateUserUsecase as unknown as UpdateUserUsecase,
                deleteUserUsecase as unknown as DeleteUserUsecase,
                prismaService as unknown as PrismaService,
                auditWriter as unknown as AdminAuditEventWriter,
            );
        });

        it("writes exactly one success audit event with the correct action/before/after/actor when a role change is applied", async () => {
            prismaService.user.findUnique.mockResolvedValue({
                id: "user_1", role: "admin", name: "A", profileImage: null,
            });
            prismaService.user.update.mockResolvedValue({
                id: "user_1", role: "manager", name: "A", profileImage: null,
            });

            const result = await service.update("user_1", {
                role: "manager",
                callerRole: "owner",
                actor,
            });

            expect(result.role).toBe("manager");
            expect(auditWriter.append).toHaveBeenCalledTimes(1);
            expect(auditWriter.append).toHaveBeenCalledWith(
                prismaService,
                expect.objectContaining({
                    action: "user.role_change",
                    targetType: "user",
                    targetId: "user_1",
                    before: "admin",
                    after: "manager",
                    outcome: "success",
                    actor,
                }),
            );
        });

        it("runs the role update and the audit append against the same transaction client, in order, and propagates an audit failure out of the callback (the signal a real transaction rolls back on)", async () => {
            // The default createMockPrismaService() $transaction mock hands the callback
            // the plain prismaService object itself, which can't distinguish "ran against
            // the transaction client" from "ran against the plain client". This test wires
            // a distinct sentinel tx client instead, so identity is actually provable.
            const events: string[] = [];
            const txClient = {
                user: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: "user_1", role: "admin", name: "A", profileImage: null,
                    }),
                    update: jest.fn().mockImplementation(async () => {
                        events.push("user.update");
                        return { id: "user_1", role: "manager", name: "A", profileImage: null };
                    }),
                },
                branch: { findMany: jest.fn().mockResolvedValue([]) },
                auth_session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            };
            prismaService.$transaction.mockImplementation(
                async (callback: (tx: unknown) => Promise<unknown>) => callback(txClient),
            );
            auditWriter.append.mockImplementation(async (tx: unknown) => {
                events.push(tx === txClient ? "audit.append(tx)" : "audit.append(wrong-client)");
                throw new Error("audit db down");
            });

            await expect(
                service.update("user_1", { role: "manager", callerRole: "owner", actor }),
            ).rejects.toThrow("audit db down");

            // Both the role update and the audit append ran, in order, against the exact
            // transaction client the $transaction callback received (not the plain client),
            // and the audit failure propagated out of the callback -- the signal a real
            // Postgres transaction uses to roll back everything the callback did.
            expect(events).toEqual(["user.update", "audit.append(tx)"]);
        });

        it("rejects granting role 'owner' even when the caller is owner, writes a rejected audit event, and does not mutate the user", async () => {
            prismaService.user.findUnique.mockResolvedValue({
                id: "user_1", role: "admin", name: "A", profileImage: null,
            });

            await expect(
                service.update("user_1", { role: "owner", callerRole: "owner", actor }),
            ).rejects.toThrow(ForbiddenException);

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(auditWriter.append).toHaveBeenCalledTimes(1);
            expect(auditWriter.append).toHaveBeenCalledWith(
                prismaService,
                expect.objectContaining({
                    action: "user.role_change",
                    targetType: "user",
                    targetId: "user_1",
                    before: "admin",
                    after: "owner",
                    outcome: "rejected",
                    actor,
                }),
            );
            expect(auditWriter.append.mock.calls[0][1].reason).toBeTruthy();
        });

        it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
            "rejects role '%s' as not assignable (an Object.prototype key must never pass the rank-lookup gate)",
            async (role) => {
                prismaService.user.findUnique.mockResolvedValue({
                    id: "user_1", role: "admin", name: "A", profileImage: null,
                });

                await expect(
                    service.update("user_1", { role, callerRole: "owner", actor }),
                ).rejects.toThrow(ForbiddenException);

                expect(prismaService.user.update).not.toHaveBeenCalled();
            },
        );

        it("still throws ForbiddenException (not masked) when the best-effort rejected-grant audit write itself fails", async () => {
            prismaService.user.findUnique.mockResolvedValue({
                id: "user_1", role: "admin", name: "A", profileImage: null,
            });
            auditWriter.append.mockRejectedValueOnce(new Error("audit db down"));

            await expect(
                service.update("user_1", { role: "owner", callerRole: "owner", actor }),
            ).rejects.toThrow(ForbiddenException);
            expect(prismaService.user.update).not.toHaveBeenCalled();
        });

        it("does not audit unrelated profile-only updates as a role change", async () => {
            prismaService.user.findUnique.mockResolvedValue({
                id: "user_1", role: "admin", name: "Old", profileImage: null,
            });
            prismaService.user.update.mockResolvedValue({
                id: "user_1", role: "admin", name: "New", profileImage: null,
            });

            await service.update("user_1", { name: "New", actor });

            expect(auditWriter.append).toHaveBeenCalledTimes(1);
            expect(auditWriter.append).toHaveBeenCalledWith(
                prismaService,
                expect.objectContaining({ action: "user.profile.updated" }),
            );
        });

        it("still throws ForbiddenException when a non-owner attempts a role change (existing guard preserved)", async () => {
            prismaService.user.findUnique.mockResolvedValue({
                id: "user_1", role: "admin", name: "A", profileImage: null,
            });

            await expect(
                service.update("user_1", { role: "manager", callerRole: "manager", actor }),
            ).rejects.toThrow(ForbiddenException);
            expect(prismaService.user.update).not.toHaveBeenCalled();
        });

        it("still throws ForbiddenException when attempting to change an existing owner's role (existing guard preserved)", async () => {
            prismaService.user.findUnique.mockResolvedValue({
                id: "user_1", role: "owner", name: "A", profileImage: null,
            });

            await expect(
                service.update("user_1", { role: "manager", callerRole: "owner", actor }),
            ).rejects.toThrow(ForbiddenException);
            expect(prismaService.user.update).not.toHaveBeenCalled();
        });

        it("rejects a branchId with no branchRole instead of silently discarding it as a global update", async () => {
            await expect(
                service.update("user_1", { branchId: "branch-1", name: "New", actor }),
            ).rejects.toThrow(BadRequestException);

            expect(prismaService.user.findUnique).not.toHaveBeenCalled();
            expect(prismaService.$transaction).not.toHaveBeenCalled();
        });

        it("rejects a role-change request with no resolvable audit actor instead of falling through unaudited", async () => {
            await expect(
                service.update("user_1", { role: "manager", callerRole: "owner" }),
            ).rejects.toThrow(BadRequestException);

            expect(prismaService.user.findUnique).not.toHaveBeenCalled();
            expect(updateUserUsecase.execute).not.toHaveBeenCalled();
        });
    });
    // ============================================
    // update (branch membership) -- owner invisibility
    // ============================================
    describe("update (branch membership, owner target) -- 권한-02a / BJJ-436", () => {
        const ownerTarget = { id: "owner-1", role: "owner", name: "대표" };
        let membershipUpdateMany: jest.Mock;

        const callerActor: AdminAuditActor = { userId: "caller-1" };

        // The caller's rows are re-read inside the transaction (권한-04): the user lookup is
        // keyed by id so the target and the caller never share one canned answer.
        const mockCaller = (globalRole: string, membershipRole: string | null) => {
            prismaService.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
                where.id === "caller-1" ? { role: globalRole } : ownerTarget);
            Object.assign(prismaService.user_branch, {
                findUnique: jest.fn().mockImplementation(async ({ where }: { where: { userId_branchId: { userId: string } } }) =>
                    where.userId_branchId.userId === "caller-1"
                        ? (membershipRole ? { role: membershipRole } : null)
                        : { userId: "owner-1", branchId: "branch-1", role: "admin" }),
            });
        };

        beforeEach(() => {
            membershipUpdateMany = jest.fn();
            prismaService.branch.findUnique.mockResolvedValue({ id: "branch-1", ownerId: "someone-else" });
            prismaService.user.findUnique.mockResolvedValue(ownerTarget);
            Object.assign(prismaService.user_branch, { updateMany: membershipUpdateMany });
        });

        it.each(["admin", "manager"])("answers not-found for an owner target when the caller is %s, and writes nothing", async (membershipRole) => {
            mockCaller("user", membershipRole);

            await expect(
                service.update("owner-1", { branchId: "branch-1", branchRole: "admin", actor: callerActor }),
            ).rejects.toBeInstanceOf(NotFoundException);

            expect(membershipUpdateMany).not.toHaveBeenCalled();
        });

        it("lets an owner caller update an owner target's branch membership with the permitted admin role", async () => {
            prismaService.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
                where.id === "caller-1" ? { role: "owner" } : ownerTarget);
            const membershipFindUnique = jest.fn().mockResolvedValue({ userId: "owner-1", branchId: "branch-1", role: "admin" });
            Object.assign(prismaService.user_branch, { findUnique: membershipFindUnique });
            membershipUpdateMany.mockResolvedValue({ count: 1 });

            const result = await service.update("owner-1", { branchId: "branch-1", branchRole: "admin", actor: callerActor });

            expect(membershipFindUnique).toHaveBeenCalledWith({
                where: { userId_branchId: { userId: "owner-1", branchId: "branch-1" } },
            });
            expect(membershipUpdateMany).toHaveBeenCalledTimes(1);
            expect(membershipUpdateMany).toHaveBeenCalledWith({
                where: { userId: "owner-1", branchId: "branch-1" },
                data: { role: "admin" },
            });
            expect(result).toMatchObject({ id: "owner-1", role: "owner", name: "대표" });
        });

        it("does not hide the owner target from an owner caller (reaches the owner-role guard instead)", async () => {
            prismaService.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
                where.id === "caller-1" ? { role: "owner" } : ownerTarget);

            await expect(
                service.update("owner-1", { branchId: "branch-1", branchRole: "manager", actor: callerActor }),
            ).rejects.toBeInstanceOf(ConflictException);
        });
    });

    // ============================================
    // branch role delegation -- 권한-04 / BJJ-435
    // ============================================
    describe("branch role delegation (권한-04, BJJ-435)", () => {
        const BRANCH = "branch-1";

        interface Scenario {
            /** The caller's CURRENT global role, as read inside the transaction. */
            callerGlobal?: string | null;
            /** The caller's CURRENT membership role in the branch (null = no row). */
            callerMembership?: string | null;
            targetGlobal?: string | null;
            targetMembership?: string | null;
            targetApproval?: string;
            branchOwnerId?: string | null;
        }

        let membershipUpdateMany: jest.Mock;

        // The actor the controller built from the (possibly stale) token: it claims 지점장.
        // The decision must ignore these fields and use the rows re-read below.
        const callerActor: AdminAuditActor = { userId: "caller-1", globalRole: "owner", branchRole: "admin" };

        const arrange = (scenario: Scenario) => {
            const {
                callerGlobal = "user",
                callerMembership = "admin",
                targetGlobal = "user",
                targetMembership = "user",
                targetApproval = "approved",
                branchOwnerId = null,
            } = scenario;
            membershipUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
            prismaService.branch.findUnique.mockResolvedValue({ id: BRANCH, ownerId: branchOwnerId });
            prismaService.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
                if (where.id === "caller-1") return { id: "caller-1", role: callerGlobal };
                if (where.id === "target-1") {
                    return { id: "target-1", name: "대상", role: targetGlobal, approvalStatus: targetApproval };
                }
                return null;
            });
            Object.assign(prismaService.user_branch, {
                updateMany: membershipUpdateMany,
                findUnique: jest.fn().mockImplementation(
                    async ({ where }: { where: { userId_branchId: { userId: string } } }) => {
                        const role = where.userId_branchId.userId === "caller-1" ? callerMembership : targetMembership;
                        return role === null ? null : { role };
                    },
                ),
            });
            prismaService.user_branch.deleteMany.mockResolvedValue({ count: 1 });
        };

        // `null` means "the request carried no actor at all".
        const actorFor = (actor: AdminAuditActor | null | undefined): AdminAuditActor | undefined =>
            actor === undefined ? callerActor : actor ?? undefined;
        const change = (role: string, actor?: AdminAuditActor | null) =>
            service.update("target-1", { branchId: BRANCH, branchRole: role, actor: actorFor(actor) });
        const remove = (actor?: AdminAuditActor | null) =>
            service.delete("target-1", BRANCH, actorFor(actor));

        const expectNothingWritten = () => {
            expect(membershipUpdateMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        };

        const expectForbidden = async (promise: Promise<unknown>) => {
            await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
            await expect(promise).rejects.toMatchObject({
                status: 403,
                response: expect.objectContaining({ code: "ACCESS_DENIED", outcome: "NOT_APPLIED" }),
            });
            expectNothingWritten();
        };

        describe("changing a branch role", () => {
            it("lets 지점장 make a 회원 a 매니저 in their own branch", async () => {
                arrange({ callerMembership: "admin", targetMembership: "user", targetGlobal: "user" });

                await change("manager");

                expect(membershipUpdateMany).toHaveBeenCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                    data: { role: "manager" },
                });
            });

            it("lets 지점장 demote a 매니저 to 회원", async () => {
                arrange({ callerMembership: "admin", targetMembership: "manager", targetGlobal: "manager" });

                await change("user");

                expect(membershipUpdateMany).toHaveBeenCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                    data: { role: "user" },
                });
            });

            it("refuses 지점장 making anyone 지점장 (rank must be strictly below the caller's)", async () => {
                arrange({ callerMembership: "admin", targetMembership: "user", targetGlobal: "user" });

                await expectForbidden(change("admin"));
            });

            it("refuses 지점장 changing another 지점장", async () => {
                arrange({ callerMembership: "admin", targetMembership: "admin", targetGlobal: "admin" });

                await expectForbidden(change("user"));
            });

            it("ranks the branch's appointed 지점장 as admin even without a membership row: 403, not the ownership 409", async () => {
                arrange({
                    callerMembership: "admin",
                    targetMembership: null,
                    targetGlobal: "user",
                    branchOwnerId: "target-1",
                });

                await expectForbidden(change("manager"));
            });

            it("refuses 지점장 changing a member whose GLOBAL role is 지점장 even if the branch row says 매니저", async () => {
                arrange({ callerMembership: "admin", targetMembership: "manager", targetGlobal: "admin" });

                await expectForbidden(change("user"));
            });

            it("treats the branch's appointed 지점장 as 지점장 and answers 403 before the ownership 409", async () => {
                arrange({
                    callerMembership: "admin",
                    targetMembership: "manager",
                    targetGlobal: "manager",
                    branchOwnerId: "target-1",
                });

                await expectForbidden(change("user"));
            });

            it("answers not-found for an owner target (BJJ-436 behaviour unchanged) and writes nothing", async () => {
                arrange({ callerMembership: "admin", targetGlobal: "owner", targetMembership: "admin" });

                await expect(change("user")).rejects.toBeInstanceOf(NotFoundException);
                expectNothingWritten();
            });

            it("lets 매니저 set a 회원 to 회원 (the no-op the code already tolerates)", async () => {
                arrange({ callerMembership: "manager", targetMembership: "user", targetGlobal: "user" });

                await change("user");

                expect(membershipUpdateMany).toHaveBeenCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                    data: { role: "user" },
                });
            });

            it("refuses 매니저 making a 회원 a 매니저", async () => {
                arrange({ callerMembership: "manager", targetMembership: "user", targetGlobal: "user" });

                await expectForbidden(change("manager"));
            });

            it("refuses 매니저 touching another 매니저", async () => {
                arrange({ callerMembership: "manager", targetMembership: "manager", targetGlobal: "manager" });

                await expectForbidden(change("user"));
            });

            it.each(["admin", "manager"])("refuses 매니저 touching a %s target at or above their rank", async (targetRole) => {
                arrange({ callerMembership: "manager", targetMembership: targetRole, targetGlobal: targetRole });

                await expectForbidden(change("user"));
            });

            it.each(["admin", "manager", "user"])("refuses a 회원 caller changing anyone to %s", async (requested) => {
                arrange({ callerMembership: "user", targetMembership: "user", targetGlobal: "user" });

                await expectForbidden(change(requested));
            });

            it("refuses a caller with no membership row in the branch", async () => {
                arrange({ callerMembership: null, targetMembership: "user" });

                await expectForbidden(change("user"));
            });

            it("answers not-found for a target who is not a member of the caller's branch, as before", async () => {
                arrange({ callerMembership: "admin", targetMembership: null, targetGlobal: "user" });

                await expect(change("manager")).rejects.toBeInstanceOf(NotFoundException);
                expectNothingWritten();
            });

            it("refuses a non-owner caller changing themself", async () => {
                arrange({ callerMembership: "admin" });
                prismaService.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
                    ({ id: where.id, name: "본인", role: "user", approvalStatus: "approved" }));

                await expectForbidden(
                    service.update("caller-1", { branchId: BRANCH, branchRole: "user", actor: callerActor }),
                );
            });

            it("refuses a request that carries no caller id and writes nothing", async () => {
                arrange({ callerMembership: "admin", targetMembership: "user" });

                await expectForbidden(change("manager", {}));
                await expectForbidden(change("manager", null));
            });

            it("refuses when the caller was demoted before the transaction ran, whatever the token still claims", async () => {
                // The actor still says 지점장; the membership row re-read in the transaction says 회원.
                arrange({ callerMembership: "user", targetMembership: "user", targetGlobal: "user" });

                await expectForbidden(change("manager"));
            });

            it("refuses when the caller was demoted from 지점장 to 매니저 and now aims above their rank", async () => {
                arrange({ callerMembership: "manager", targetMembership: "manager", targetGlobal: "manager" });

                await expectForbidden(change("user"));
            });

            it("refuses an account that is not approved (non-owner caller) and writes nothing", async () => {
                arrange({ callerMembership: "admin", targetMembership: "user", targetApproval: "pending" });

                await expect(change("manager")).rejects.toMatchObject({
                    status: 400,
                    response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
                });
                expectNothingWritten();
            });

            it("still lets an owner caller promote to 지점장, change a 지점장 and touch unapproved accounts", async () => {
                arrange({ callerGlobal: "owner", callerMembership: null, targetMembership: "user", targetApproval: "pending" });
                await change("admin");
                expect(membershipUpdateMany).toHaveBeenLastCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                    data: { role: "admin" },
                });

                arrange({ callerGlobal: "owner", callerMembership: null, targetMembership: "admin", targetGlobal: "admin" });
                await change("manager");
                expect(membershipUpdateMany).toHaveBeenLastCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                    data: { role: "manager" },
                });
            });

            it("keeps the ownership 409 for an owner caller", async () => {
                arrange({
                    callerGlobal: "owner",
                    callerMembership: null,
                    targetMembership: "admin",
                    targetGlobal: "admin",
                    branchOwnerId: "target-1",
                });

                await expect(change("manager")).rejects.toBeInstanceOf(ConflictException);
            });
        });

        describe("removing a branch member", () => {
            it("lets 지점장 remove a 매니저 and revokes that member's sessions", async () => {
                arrange({ callerMembership: "admin", targetMembership: "manager", targetGlobal: "manager" });

                await remove();

                expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                });
                expect(prismaService.auth_session.updateMany).toHaveBeenCalledWith({
                    where: { userId: "target-1", revokedAt: null },
                    data: { revokedAt: expect.any(Date), revokedReason: "membership_deleted" },
                });
            });

            it("lets 지점장 remove a 회원", async () => {
                arrange({ callerMembership: "admin", targetMembership: "user", targetGlobal: "user" });

                await remove();

                expect(prismaService.user_branch.deleteMany).toHaveBeenCalledTimes(1);
            });

            it("lets 매니저 remove a 회원", async () => {
                arrange({ callerMembership: "manager", targetMembership: "user", targetGlobal: "user" });

                await remove();

                expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                });
            });

            it("refuses 지점장 removing another 지점장", async () => {
                arrange({ callerMembership: "admin", targetMembership: "admin", targetGlobal: "admin" });

                await expectForbidden(remove());
            });

            it("answers 403, not the ownership 409, when 지점장 removes the branch's appointed 지점장", async () => {
                arrange({
                    callerMembership: "admin",
                    targetMembership: "admin",
                    targetGlobal: "admin",
                    branchOwnerId: "target-1",
                });

                await expectForbidden(remove());
            });

            it("ranks the branch's appointed 지점장 as admin even without a membership row: 403, not the ownership 409", async () => {
                arrange({
                    callerMembership: "admin",
                    targetMembership: null,
                    targetGlobal: "user",
                    branchOwnerId: "target-1",
                });

                await expectForbidden(remove());
            });

            it("refuses 매니저 removing a 매니저", async () => {
                arrange({ callerMembership: "manager", targetMembership: "manager", targetGlobal: "manager" });

                await expectForbidden(remove());
            });

            it("answers not-found for an owner target and writes nothing", async () => {
                arrange({ callerMembership: "admin", targetGlobal: "owner", targetMembership: "admin" });

                await expect(remove()).rejects.toBeInstanceOf(NotFoundException);
                expectNothingWritten();
            });

            it("refuses a 회원 caller", async () => {
                arrange({ callerMembership: "user", targetMembership: "user", targetGlobal: "user" });

                await expectForbidden(remove());
            });

            it("answers not-found for a target outside the caller's branch, as before", async () => {
                arrange({ callerMembership: "admin", targetMembership: null, targetGlobal: "user" });

                await expect(remove()).rejects.toBeInstanceOf(NotFoundException);
                expectNothingWritten();
            });

            it("refuses a non-owner caller removing themself", async () => {
                arrange({ callerMembership: "admin" });
                prismaService.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
                    ({ id: where.id, role: "user", approvalStatus: "approved" }));

                await expectForbidden(service.delete("caller-1", BRANCH, callerActor));
            });

            it("refuses a request with no caller id", async () => {
                arrange({ callerMembership: "admin", targetMembership: "user" });

                await expectForbidden(remove({}));
                await expectForbidden(remove(null));
            });

            it("refuses when the caller was demoted before the transaction ran", async () => {
                arrange({ callerMembership: "user", targetMembership: "user", targetGlobal: "user" });

                await expectForbidden(remove());
            });

            it("refuses removing an account that is not approved (non-owner caller)", async () => {
                arrange({ callerMembership: "admin", targetMembership: "user", targetApproval: "pending" });

                await expect(remove()).rejects.toMatchObject({
                    status: 400,
                    response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
                });
                expectNothingWritten();
            });

            it("still lets an owner caller remove a 지점장 member", async () => {
                arrange({ callerGlobal: "owner", callerMembership: null, targetMembership: "admin", targetGlobal: "admin" });

                await remove();

                expect(prismaService.user_branch.deleteMany).toHaveBeenCalledTimes(1);
            });

            it("keeps the ownership 409 for an owner caller removing the appointed 지점장", async () => {
                arrange({
                    callerGlobal: "owner",
                    callerMembership: null,
                    targetMembership: "admin",
                    targetGlobal: "admin",
                    branchOwnerId: "target-1",
                });

                await expect(remove()).rejects.toBeInstanceOf(ConflictException);
            });
        });
    });

    // ============================================
    // owner-only global writes re-read the caller -- 권한-04 / BJJ-435
    // ============================================
    describe("owner-only global writes re-read the caller inside the transaction (권한-04, BJJ-435)", () => {
        const demotedCaller = () => {
            // The token says owner; the row read inside the transaction says 지점장.
            prismaService.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
                where.id === "owner-1" ? { role: "admin" } : { id: where.id, role: "manager", approvalStatus: "approved" });
        };
        const forbidden = { status: 403, response: expect.objectContaining({ code: "ACCESS_DENIED" }) };

        it("approve: refuses a caller who is no longer owner and writes nothing", async () => {
            demotedCaller();

            await expect(service.approve("u1", {
                role: "manager",
                approvedBy: "owner-1",
                actor: ownerActor,
                branchId: "branch-1",
            })).rejects.toMatchObject(forbidden);

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("approve: refuses a request with no caller id", async () => {
            prismaService.user.findUnique.mockResolvedValue({ role: "owner" });

            await expect(service.approve("u1", {
                role: "manager",
                approvedBy: "",
                branchId: "branch-1",
            })).rejects.toMatchObject(forbidden);

            expect(prismaService.user.update).not.toHaveBeenCalled();
        });

        it("reject: refuses a caller who is no longer owner and writes nothing", async () => {
            demotedCaller();

            await expect(service.reject("u1", ownerActor)).rejects.toMatchObject(forbidden);

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("reject: refuses a request with no actor", async () => {
            prismaService.user.findUnique.mockResolvedValue({ id: "u1", role: "owner" });

            await expect(service.reject("u1")).rejects.toMatchObject(forbidden);

            expect(prismaService.user.update).not.toHaveBeenCalled();
        });

        it("updateAccountAssignment: refuses a caller who is no longer owner even though callerRole says owner", async () => {
            demotedCaller();

            await expect(service.updateAccountAssignment("u1", {
                role: "user",
                branchIds: ["11111111-1111-4111-8111-111111111111"],
                expectedRole: "manager",
                expectedBranchIds: ["11111111-1111-4111-8111-111111111111"],
                callerRole: "owner",
                actor: ownerActor,
            })).rejects.toMatchObject(forbidden);

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("updateAccountAssignment: refuses a request with no actor", async () => {
            prismaService.user.findUnique.mockResolvedValue({ role: "owner" });

            await expect(service.updateAccountAssignment("u1", {
                role: "user",
                branchIds: ["11111111-1111-4111-8111-111111111111"],
                expectedRole: "manager",
                expectedBranchIds: ["11111111-1111-4111-8111-111111111111"],
                callerRole: "owner",
            })).rejects.toMatchObject(forbidden);

            expect(prismaService.user.update).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // The caller is re-read with the TRANSACTION client -- 권한-04 / BJJ-435 (M3)
    //
    // The shared fixture hands the root Prisma mock to the transaction callback, so a read
    // that wrongly goes through the root client looks identical to a correct one. Here the
    // transaction gets its OWN client; the root client is told the opposite story.
    // ============================================
    describe("caller authority comes from the transaction client, not the root client (권한-04, BJJ-435)", () => {
        const BRANCH = "branch-1";
        const callerActor: AdminAuditActor = { userId: "caller-1", globalRole: "owner", branchRole: "admin" };
        const forbidden = { status: 403, response: expect.objectContaining({ code: "ACCESS_DENIED" }) };
        const goodAssignment = {
            role: "user" as const,
            branchIds: ["11111111-1111-4111-8111-111111111111"],
            expectedRole: "manager" as const,
            expectedBranchIds: ["11111111-1111-4111-8111-111111111111"],
        };

        let txClient: ReturnType<typeof createMockPrismaService>;

        interface Authority {
            /** Global role of the caller row; null = no row at all. */
            global: string | null;
            /** Caller's membership role in the branch; null = no row. */
            membership?: string | null;
        }

        /** Wires `client` so that caller-1 / owner-1 resolve to `caller`, and the target is an ordinary member. */
        const arrangeClient = (
            client: ReturnType<typeof createMockPrismaService>,
            caller: Authority,
        ) => {
            client.branch.findUnique.mockResolvedValue({ id: BRANCH, ownerId: null });
            client.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
                if (where.id === "caller-1" || where.id === "owner-1") {
                    return caller.global === null ? null : { id: where.id, role: caller.global };
                }
                return { id: where.id, name: "대상", role: "user", approvalStatus: "approved" };
            });
            client.user_branch.findUnique.mockImplementation(
                async ({ where }: { where: { userId_branchId: { userId: string } } }) => {
                    const role = where.userId_branchId.userId === "caller-1" ? caller.membership : "user";
                    return role === null || role === undefined ? null : { role };
                },
            );
            client.user_branch.updateMany.mockResolvedValue({ count: 1 });
            client.user_branch.deleteMany.mockResolvedValue({ count: 1 });
        };

        /** The root client says `root`; the transaction client says `tx`. */
        const arrange = (root: Authority, tx: Authority) => {
            txClient = createMockPrismaService();
            arrangeClient(prismaService, root);
            arrangeClient(txClient, tx);
            prismaService.$transaction.mockImplementation(async (callback) => callback(txClient));
        };

        const expectNothingWrittenAnywhere = () => {
            for (const client of [prismaService, txClient]) {
                expect(client.user.update).not.toHaveBeenCalled();
                expect(client.branch.updateMany).not.toHaveBeenCalled();
                expect(client.user_branch.updateMany).not.toHaveBeenCalled();
                expect(client.user_branch.upsert).not.toHaveBeenCalled();
                expect(client.user_branch.deleteMany).not.toHaveBeenCalled();
                expect(client.auth_session.updateMany).not.toHaveBeenCalled();
            }
        };

        const changeRole = () =>
            service.update("target-1", { branchId: BRANCH, branchRole: "manager", actor: callerActor });
        const removeMember = () => service.delete("target-1", BRANCH, callerActor);
        const approveUser = () =>
            service.approve("u1", { role: "manager", approvedBy: "owner-1", actor: ownerActor, branchId: BRANCH });
        const rejectUser = () => service.reject("u1", ownerActor);
        const assign = () =>
            service.updateAccountAssignment("u1", { ...goodAssignment, callerRole: "owner", actor: ownerActor });

        describe("root client says the caller is an owner or 지점장; the transaction says a plain 회원", () => {
            const rootSaysPowerful: Authority = { global: "owner", membership: "admin" };
            const txSaysPlain: Authority = { global: "user", membership: "user" };

            it("branch role change: refused, nothing written", async () => {
                arrange(rootSaysPowerful, txSaysPlain);

                await expect(changeRole()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("branch role change: a 회원 membership read through the root client alone does not authorize it", async () => {
                arrange({ global: "user", membership: "admin" }, { global: "user", membership: "user" });

                await expect(changeRole()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("branch member removal: refused, nothing written", async () => {
                arrange(rootSaysPowerful, txSaysPlain);

                await expect(removeMember()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("branch member removal: a 회원 membership read through the root client alone does not authorize it", async () => {
                arrange({ global: "user", membership: "admin" }, { global: "user", membership: "user" });

                await expect(removeMember()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("approve: refused, nothing written", async () => {
                arrange({ global: "owner" }, { global: "admin" });

                await expect(approveUser()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("reject: refused, nothing written", async () => {
                arrange({ global: "owner" }, { global: "admin" });

                await expect(rejectUser()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("updateAccountAssignment: refused, nothing written", async () => {
                arrange({ global: "owner" }, { global: "admin" });

                await expect(assign()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });
        });

        describe("root client says a plain 회원; the transaction says 지점장", () => {
            it("branch role change: allowed, and the write goes through the transaction client", async () => {
                arrange({ global: "user", membership: "user" }, { global: "user", membership: "admin" });

                await changeRole();

                expect(txClient.user_branch.updateMany).toHaveBeenCalledWith({
                    where: { userId: "target-1", branchId: BRANCH },
                    data: { role: "manager" },
                });
                expect(prismaService.user_branch.updateMany).not.toHaveBeenCalled();
            });
        });

        describe("the transaction returns no row for the caller account", () => {
            it("branch role change: refused with 403 and nothing written (even though the root client has an owner)", async () => {
                arrange({ global: "owner", membership: "admin" }, { global: null });

                await expect(changeRole()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("branch member removal: refused with 403 and nothing written", async () => {
                arrange({ global: "owner", membership: "admin" }, { global: null });

                await expect(removeMember()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });

            it("approve: refused with 403 and nothing written", async () => {
                arrange({ global: "owner" }, { global: null });

                await expect(approveUser()).rejects.toMatchObject(forbidden);

                expectNothingWrittenAnywhere();
            });
        });
    });
});
