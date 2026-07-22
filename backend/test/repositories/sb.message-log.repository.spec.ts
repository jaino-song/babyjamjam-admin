import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";

describe("SbMessageLogRepository", () => {
    const createMockPrismaMessageLog = () => ({
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
    });

    let messageLogModel: ReturnType<typeof createMockPrismaMessageLog>;
    let prisma: PrismaService;
    let repository: SbMessageLogRepository;

    beforeEach(() => {
        messageLogModel = createMockPrismaMessageLog();
        prisma = {
            message_log: messageLogModel,
            $transaction: jest.fn(async (callback) => callback({ message_log: messageLogModel })),
        } as unknown as PrismaService;
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

    describe("startRetryAttempt", () => {
        const source = MessageLogEntity.reconstitute(
            77,
            "11111111-1111-1111-1111-111111111111",
            "aligo_sms",
            "service_record_link_sms",
            "job-1",
            "01012345678",
            7,
            "message",
            {},
            "failed",
            null,
            "등록되지 않은 발신번호입니다.",
            1,
            new Date("2026-07-22T17:13:11.000Z"),
            new Date("2026-07-22T17:18:11.000Z"),
            new Date("2026-07-22T17:13:11.000Z"),
        );
        const retryDraft = MessageLogEntity.reconstitute(
            0,
            source.branchId,
            source.provider,
            source.templateKey,
            source.triggerJobId,
            source.receiver,
            source.clientId,
            source.messageBody,
            { retryOfLogId: "77", retryAttempt: "2" },
            "pending",
            null,
            null,
            1,
            null,
            null,
            new Date("2026-07-22T17:18:11.000Z"),
        );

        it("should clear only the source retry schedule and create a separate attempt", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            messageLogModel.create.mockResolvedValue({
                id: 78,
                branchId: retryDraft.branchId,
                provider: retryDraft.provider,
                templateKey: retryDraft.templateKey,
                triggerJobId: retryDraft.triggerJobId,
                receiver: retryDraft.receiver,
                clientId: retryDraft.clientId,
                recipientName: null,
                recipientPhone: retryDraft.receiver,
                messageBody: retryDraft.messageBody,
                variables: retryDraft.variables,
                status: "pending",
                aligoMid: null,
                errorMessage: null,
                attempts: 1,
                lastAttemptAt: null,
                nextRetryAt: null,
                createdAt: retryDraft.createdAt,
                updatedAt: retryDraft.createdAt,
            });

            const result = await repository.startRetryAttempt(source, retryDraft);

            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 77,
                    status: "failed",
                    nextRetryAt: source.nextRetryAt,
                },
                data: { nextRetryAt: null },
            });
            expect(messageLogModel.create).toHaveBeenCalled();
            expect(result).toEqual(expect.objectContaining({ id: 78, status: "pending" }));
            expect(source).toEqual(expect.objectContaining({
                id: 77,
                status: "failed",
                errorMessage: "등록되지 않은 발신번호입니다.",
            }));
        });

        it("should not create a duplicate attempt when the source was already claimed", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 0 });

            await expect(repository.startRetryAttempt(source, retryDraft)).resolves.toBeNull();

            expect(messageLogModel.create).not.toHaveBeenCalled();
        });
    });
});
