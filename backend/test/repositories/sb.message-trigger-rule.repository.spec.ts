import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";

describe("SbMessageTriggerRuleRepository", () => {
    type MockMessageTriggerRuleRow = {
        id: string;
        branchId: string | null;
        name: string;
        isActive: boolean;
        eventType: string;
        offsetType: string;
        offsetDays: number;
        recipientType: string;
        templateKey: string;
        isDefault: boolean;
        jobsStale: boolean;
        createdAt: Date;
        updatedAt: Date;
    };

    const createMockPrismaMessageTriggerRule = () => ({
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
    });

    const createRow = (
        overrides: Partial<MockMessageTriggerRuleRow> = {},
    ): MockMessageTriggerRuleRow => ({
        id: "rule-1",
        branchId: "branch-1",
        name: "서비스 시작 7일 전 서비스 안내",
        isActive: false,
        eventType: MessageTriggerEventType.SERVICE_START,
        offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
        offsetDays: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        isDefault: true,
        jobsStale: false,
        createdAt: new Date("2026-07-08T00:00:00.000Z"),
        updatedAt: new Date("2026-07-08T01:00:00.000Z"),
        ...overrides,
    });

    let messageTriggerRuleModel: ReturnType<typeof createMockPrismaMessageTriggerRule>;
    let repository: SbMessageTriggerRuleRepository;

    beforeEach(() => {
        messageTriggerRuleModel = createMockPrismaMessageTriggerRule();
        repository = new SbMessageTriggerRuleRepository({
            message_trigger_rule: messageTriggerRuleModel,
        } as unknown as PrismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("findInactiveDefaultRules queries inactive defaults oldest updated first with default limit", async () => {
        messageTriggerRuleModel.findMany.mockResolvedValue([createRow()]);

        const result = await repository.findInactiveDefaultRules();

        expect(messageTriggerRuleModel.findMany).toHaveBeenCalledWith({
            where: {
                isDefault: true,
                isActive: false,
            },
            orderBy: { updatedAt: "asc" },
            take: 50,
        });
        expect(result[0]?.isDefault).toBe(true);
        expect(result[0]?.isActive).toBe(false);
    });

    it("findInactiveDefaultRules respects the provided limit", async () => {
        messageTriggerRuleModel.findMany.mockResolvedValue([]);

        await repository.findInactiveDefaultRules(12);

        expect(messageTriggerRuleModel.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                take: 12,
            }),
        );
    });
});
