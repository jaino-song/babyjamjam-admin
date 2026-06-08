import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { PrismaService } from "infrastructure/database/prisma.service";

const createMockPrisma = () => ({
    branch: {
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
        it("should save a mobile sender phone when the requester is allowed", async () => {
            const requestedAt = new Date("2026-06-05T00:00:00.000Z");
            prisma.branch.update.mockResolvedValue({
                smsSenderPhone: "01012345678",
                smsSenderApprovalStatus: "pending",
                smsSenderApprovalRequestedAt: requestedAt,
                smsSenderApprovalApprovedAt: null,
            });

            const result = await service.requestApproval({
                branchId: "branch-1",
                userId: "user-1",
                branchRole: "owner",
                senderPhone: "010-1234-5678",
            });

            expect(prisma.branch.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        smsSenderPhone: "01012345678",
                    }),
                }),
            );
            expect(result.senderPhone).toBe("01012345678");
            expect(result.approvalStatus).toBe("pending");
        });

        it("should reject a regional sender phone", async () => {
            await expect(
                service.requestApproval({
                    branchId: "branch-1",
                    userId: "user-1",
                    branchRole: "owner",
                    senderPhone: "02-1234-5678",
                }),
            ).rejects.toThrow("휴대 전화번호만 가능합니다.");
            expect(prisma.branch.update).not.toHaveBeenCalled();
        });
    });

    describe("approvePendingRequest", () => {
        it("should approve a pending sender phone request", async () => {
            const requestedAt = new Date("2026-06-04T09:00:00.000Z");
            const approvedAt = new Date("2026-06-05T00:00:00.000Z");
            prisma.branch.findUnique.mockResolvedValue({
                id: "branch-1",
                smsSenderPhone: "01012345678",
                smsSenderApprovalStatus: "pending",
                smsSenderApprovalRequestedAt: requestedAt,
            });
            prisma.branch.update.mockResolvedValue({
                smsSenderPhone: "01012345678",
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
            expect(result.senderPhone).toBe("01012345678");
        });

        it("should reject approval when the branch has no pending sender phone request", async () => {
            prisma.branch.findUnique.mockResolvedValue({
                id: "branch-1",
                smsSenderPhone: null,
                smsSenderApprovalStatus: "not_requested",
                smsSenderApprovalRequestedAt: null,
            });

            await expect(
                service.approvePendingRequest({
                    branchId: "branch-1",
                    userId: "owner-1",
                }),
            ).rejects.toThrow("승인 대기 중인 메시지 발신번호 신청이 없습니다.");
            expect(prisma.branch.update).not.toHaveBeenCalled();
        });
    });
});
