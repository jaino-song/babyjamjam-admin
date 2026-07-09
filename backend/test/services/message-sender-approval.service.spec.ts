import { ForbiddenException } from "@nestjs/common";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { PrismaService } from "infrastructure/database/prisma.service";

const createMockPrisma = () => ({
    branch: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
    },
});

describe("MessageSenderApprovalService", () => {
    let service: MessageSenderApprovalService;
    let prisma: ReturnType<typeof createMockPrisma>;

    beforeEach(() => {
        prisma = createMockPrisma();
        service = new MessageSenderApprovalService(prisma as unknown as PrismaService);
    });

    describe("canRequest", () => {
        it.each(["owner", "admin", "manager"])(
            "should allow %s to request sender approval",
            (branchRole) => {
                expect(service.canRequest(branchRole)).toBe(true);
            },
        );

        it.each([undefined, null, "staff", "employee", "viewer"])(
            "should deny %s from requesting sender approval",
            (branchRole) => {
                expect(service.canRequest(branchRole)).toBe(false);
            },
        );
    });

    describe("requestApproval", () => {
        it("should move the branch to pending when the requester is allowed", async () => {
            const requestedAt = new Date("2026-06-05T00:00:00.000Z");
            prisma.branch.update.mockResolvedValue({
                smsSenderApprovalStatus: "pending",
                smsSenderApprovalRequestedAt: requestedAt,
                smsSenderApprovalApprovedAt: null,
            });

            const result = await service.requestApproval({
                branchId: "branch-1",
                userId: "user-1",
                branchRole: "owner",
            });

            expect(prisma.branch.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "branch-1" },
                    data: expect.objectContaining({
                        smsSenderApprovalStatus: "pending",
                        smsSenderApprovalRequestedBy: "user-1",
                        smsSenderApprovalApprovedAt: null,
                        smsSenderApprovalApprovedBy: null,
                    }),
                }),
            );
            expect(result.approvalStatus).toBe("pending");
        });

        it("should reject a requester whose role is not allowed", async () => {
            await expect(
                service.requestApproval({
                    branchId: "branch-1",
                    userId: "user-1",
                    branchRole: "staff",
                }),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(prisma.branch.update).not.toHaveBeenCalled();
        });
    });

    describe("approvePendingRequest", () => {
        it("should approve a pending request", async () => {
            const requestedAt = new Date("2026-06-04T09:00:00.000Z");
            const approvedAt = new Date("2026-06-05T00:00:00.000Z");
            prisma.branch.findUnique.mockResolvedValue({
                smsSenderApprovalStatus: "pending",
            });
            prisma.branch.update.mockResolvedValue({
                smsSenderApprovalStatus: "approved",
                smsSenderApprovalRequestedAt: requestedAt,
                smsSenderApprovalApprovedAt: approvedAt,
            });

            const result = await service.approvePendingRequest({
                branchId: "branch-1",
                userId: "owner-1",
            });

            expect(prisma.branch.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "branch-1" },
                    data: expect.objectContaining({
                        smsSenderApprovalStatus: "approved",
                        smsSenderApprovalApprovedBy: "owner-1",
                    }),
                }),
            );
            expect(result.approvalStatus).toBe("approved");
        });

        it("should reject approval when the branch has no pending request", async () => {
            prisma.branch.findUnique.mockResolvedValue({
                smsSenderApprovalStatus: "not_requested",
            });

            await expect(
                service.approvePendingRequest({
                    branchId: "branch-1",
                    userId: "owner-1",
                }),
            ).rejects.toThrow("승인 대기 중인 메시지 발송 권한 신청이 없습니다.");
            expect(prisma.branch.update).not.toHaveBeenCalled();
        });
    });

    describe("getApprovedBranchIds", () => {
        it("should return an empty set without querying when no branch ids are provided", async () => {
            const result = await service.getApprovedBranchIds([]);

            expect(result.size).toBe(0);
            expect(prisma.branch.findMany).not.toHaveBeenCalled();
        });

        it("should query unique branch ids and return only approved matches", async () => {
            prisma.branch.findMany.mockResolvedValue([{ id: "branch-1" }]);

            const result = await service.getApprovedBranchIds([
                "branch-1",
                "branch-1",
                "branch-2",
            ]);

            expect(prisma.branch.findMany).toHaveBeenCalledWith({
                where: {
                    id: { in: ["branch-1", "branch-2"] },
                    smsSenderApprovalStatus: "approved",
                },
                select: { id: true },
            });
            expect(result).toEqual(new Set(["branch-1"]));
        });
    });

    describe("isApproved", () => {
        it("should resolve true only when the branch is approved", async () => {
            prisma.branch.findMany.mockResolvedValue([{ id: "branch-1" }]);

            await expect(service.isApproved("branch-1")).resolves.toBe(true);
        });

        it("should resolve false when the branch is not approved", async () => {
            prisma.branch.findMany.mockResolvedValue([]);

            await expect(service.isApproved("branch-1")).resolves.toBe(false);
        });
    });

    describe("ensureApproved", () => {
        it("should resolve when the branch is approved", async () => {
            prisma.branch.findUnique.mockResolvedValue({
                smsSenderApprovalStatus: "approved",
                smsSenderApprovalRequestedAt: null,
                smsSenderApprovalApprovedAt: null,
            });

            await expect(service.ensureApproved("branch-1")).resolves.toBeUndefined();
        });

        it("should throw when the branch is not approved", async () => {
            prisma.branch.findUnique.mockResolvedValue({
                smsSenderApprovalStatus: "pending",
                smsSenderApprovalRequestedAt: null,
                smsSenderApprovalApprovedAt: null,
            });

            await expect(service.ensureApproved("branch-1")).rejects.toBeInstanceOf(
                ForbiddenException,
            );
        });
    });
});
