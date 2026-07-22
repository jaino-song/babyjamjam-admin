import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("SbMessageLogRepository", () => {
    const createMockPrismaMessageLog = () => ({
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
    });

    let messageLogModel: ReturnType<typeof createMockPrismaMessageLog>;
    let prisma: PrismaService;
    let repository: SbMessageLogRepository;

    beforeEach(() => {
        messageLogModel = createMockPrismaMessageLog();
        prisma = { message_log: messageLogModel } as unknown as PrismaService;
        repository = new SbMessageLogRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findSentTriggerJobIds", () => {
        it("should return an empty set without querying when jobIds is empty", async () => {
            const result = await repository.findSentTriggerJobIds([]);

            expect(result).toEqual(new Set());
            expect(messageLogModel.findMany).not.toHaveBeenCalled();
        });

        it("should query sent logs and return non-null trigger job ids", async () => {
            messageLogModel.findMany.mockResolvedValue([
                { triggerJobId: "job-1" },
                { triggerJobId: null },
                { triggerJobId: "job-3" },
            ]);

            const result = await repository.findSentTriggerJobIds(["job-1", "job-2", "job-3"]);

            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    triggerJobId: { in: ["job-1", "job-2", "job-3"] },
                    status: "sent",
                },
                select: { triggerJobId: true },
            });
            expect(result).toEqual(new Set(["job-1", "job-3"]));
        });
    });

    describe("scheduleFailedForRetry", () => {
        it("atomically schedules only the branch-owned failed SMS log", async () => {
            const retryAt = new Date("2026-07-23T02:25:00.000Z");
            const nowSpy = jest.spyOn(Date, "now").mockReturnValue(retryAt.getTime());
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            messageLogModel.findFirst.mockResolvedValue({
                id: 77,
                branchId: "branch-1",
                provider: "aligo_sms",
                templateKey: "service_record_link_sms",
                triggerJobId: "job-1",
                receiver: "01012345678",
                clientId: 3,
                recipientName: "나세정",
                recipientPhone: "01012345678",
                messageBody: "제공기록지 작성 링크",
                variables: {},
                status: "pending",
                aligoMid: null,
                errorMessage: "발송 실패",
                attempts: 1,
                lastAttemptAt: new Date("2026-07-23T02:20:00.000Z"),
                nextRetryAt: retryAt,
                createdAt: new Date("2026-07-23T02:20:00.000Z"),
                updatedAt: retryAt,
            });

            const result = await repository.scheduleFailedForRetry("branch-1", 77);

            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 77,
                    branchId: "branch-1",
                    provider: "aligo_sms",
                    status: "failed",
                },
                data: {
                    status: "pending",
                    nextRetryAt: retryAt,
                },
            });
            expect(messageLogModel.findFirst).toHaveBeenCalledWith({
                where: { id: 77, branchId: "branch-1" },
            });
            expect(result).toMatchObject({
                id: 77,
                branchId: "branch-1",
                templateKey: "service_record_link_sms",
                recipientName: "나세정",
                status: "pending",
                nextRetryAt: retryAt,
            });
            nowSpy.mockRestore();
        });

        it("does not fetch a log when the failed-state claim loses a race", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 0 });

            const result = await repository.scheduleFailedForRetry("branch-1", 77);

            expect(result).toBeNull();
            expect(messageLogModel.findFirst).not.toHaveBeenCalled();
        });
    });
});
