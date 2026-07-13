import { UserService } from "../../application/services/user.service";
import {
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "../../application/usecases/user";
import { PrismaService } from "../../infrastructure/database/prisma.service";

describe("UserService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockUsecase = () => ({ execute: jest.fn() });

    const createMockPrismaService = () => {
        const prisma = {
            user: {
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn(),
            },
            user_branch: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
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
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findDirectory
    // ============================================
    describe("findDirectory", () => {
        it("should query without a where clause when no filters are provided", async () => {
            await service.findDirectory();

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: undefined }),
            );
        });

        it("should filter by approvalStatus when status is provided", async () => {
            await service.findDirectory({ status: "pending" });

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
    });

    // ============================================
    // approve
    // ============================================
    describe("approve", () => {
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
                branchId: "branch-1",
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

        it("should scope the user_branch role update to the given branchId when provided", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "approved",
                tokenVersion: 1,
            });

            await service.approve("u1", { role: "manager", approvedBy: "owner-1", branchId: "branch-9" });

            expect(prismaService.user_branch.updateMany).toHaveBeenCalledWith({
                where: { userId: "u1", branchId: "branch-9" },
                data: { role: "manager" },
            });
        });

        it("should update all of the user's branch memberships when branchId is not provided", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "approved",
                tokenVersion: 1,
            });

            await service.approve("u1", { role: "manager", approvedBy: "owner-1" });

            expect(prismaService.user_branch.updateMany).toHaveBeenCalledWith({
                where: { userId: "u1" },
                data: { role: "manager" },
            });
        });
    });

    // ============================================
    // reject
    // ============================================
    describe("reject", () => {
        it("should set approvalStatus to rejected and bump tokenVersion", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "rejected",
                tokenVersion: 1,
            });

            const result = await service.reject("u1");

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
    });
});
