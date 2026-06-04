import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { PrismaService } from "infrastructure/database/prisma.service";

const createMockPrisma = () => ({
    branch: {
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
});
