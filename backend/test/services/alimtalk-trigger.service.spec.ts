import { AlimtalkTriggerService } from "application/services/alimtalk-trigger.service";
import {
    AlimtalkTriggerEventType,
    AlimtalkTriggerOffsetType,
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerRuleEntity } from "domain/entities/alimtalk-trigger-rule.entity";

jest.mock("infrastructure/database/schema-capabilities", () => ({
    hasColumn: jest.fn().mockResolvedValue(true),
    hasTable: jest.fn().mockResolvedValue(true),
}));

describe("AlimtalkTriggerService", () => {
    const branchId = "branch-1";
    type ServiceInternals = {
        hasTriggerSchema: () => Promise<boolean>;
        rebuildJobsForRule: (
            branchId: string,
            rule: AlimtalkTriggerRuleEntity,
            includePast: boolean,
        ) => Promise<void>;
        buildClientTemplateVariables: (
            rule: AlimtalkTriggerRuleEntity,
            client: {
                name: string;
                phone: string | null;
                type?: string | null;
                startDate?: Date | null;
                endDate?: Date | null;
                createdAt?: Date | null;
                duration?: number | null;
                fullPrice?: string | null;
                grant?: string | null;
                actualPrice?: string | null;
                area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
            },
        ) => Record<string, string>;
    };

    const createRule = (overrides: Partial<{
        id: string;
        name: string;
        eventType: AlimtalkTriggerEventType;
        offsetType: AlimtalkTriggerOffsetType;
        offsetDays: number;
        recipientType: AlimtalkTriggerRecipientType;
        templateKey: AlimtalkTriggerTemplateKey;
    }> = {}) =>
        AlimtalkTriggerRuleEntity.reconstitute(
            overrides.id ?? "rule-1",
            branchId,
            overrides.name ?? "기존 규칙",
            true,
            overrides.eventType ?? AlimtalkTriggerEventType.CLIENT_CREATED,
            overrides.offsetType ?? AlimtalkTriggerOffsetType.IMMEDIATE,
            overrides.offsetDays ?? 0,
            overrides.recipientType ?? AlimtalkTriggerRecipientType.CLIENT,
            overrides.templateKey ?? AlimtalkTriggerTemplateKey.CLIENT_WELCOME,
            new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
        );

    const createService = () => {
        const ruleRepository = {
            findAll: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const service = new AlimtalkTriggerService(
            {} as never,
            {} as never,
            {} as never,
            ruleRepository as never,
            {} as never,
            {} as never,
        );

        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "hasTriggerSchema").mockResolvedValue(true);
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        return { service, internals, ruleRepository };
    };

    it("ensures the default service information trigger on rule listing", async () => {
        const { service, internals, ruleRepository } = createService();
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            name: "신규 고객 인사 메시지",
            eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
            offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
        });
        const createdServiceInfo = createRule({
            id: "rule-service-info",
            name: "서비스 시작 7일 전 서비스 안내",
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        });
        // CLIENT_GREETING already exists; only SERVICE_INFO will be created
        ruleRepository.findAll.mockResolvedValue([existingGreeting]);
        ruleRepository.create.mockResolvedValue(createdServiceInfo);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                name: "서비스 시작 7일 전 서비스 안내",
                isActive: true,
                eventType: AlimtalkTriggerEventType.SERVICE_START,
                offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                recipientType: AlimtalkTriggerRecipientType.CLIENT,
                templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
            }),
        );
        expect(internals.rebuildJobsForRule).toHaveBeenCalledWith(branchId, createdServiceInfo, false);
        expect(rules).toContainEqual(createdServiceInfo);
        expect(rules).toContainEqual(existingGreeting);
    });

    it("ensures the default CLIENT_GREETING trigger on rule listing", async () => {
        const { service, internals, ruleRepository } = createService();
        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        });
        const createdGreeting = createRule({
            id: "rule-greeting",
            name: "신규 고객 인사 메시지",
            eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
            offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
        });
        // SERVICE_INFO already exists; only CLIENT_GREETING will be created
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo]);
        ruleRepository.create.mockResolvedValue(createdGreeting);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                name: "신규 고객 인사 메시지",
                isActive: true,
                eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
                offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: AlimtalkTriggerRecipientType.CLIENT,
                templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
            }),
        );
        expect(rules).toContainEqual(createdGreeting);
        expect(rules).toContainEqual(existingServiceInfo);
    });

    it("does not duplicate existing default triggers when both already exist", async () => {
        const { service, internals, ruleRepository } = createService();
        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        });
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
            offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo, existingGreeting]);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(rules).toEqual([existingServiceInfo, existingGreeting]);
    });

    it("does not enqueue jobs for existing clients when an IMMEDIATE CLIENT_GREETING rule is created", async () => {
        // Do NOT spy on rebuildJobsForRule — let the real guard run.
        const jobRepository = { upsertPending: jest.fn() };
        const service = new AlimtalkTriggerService(
            {} as never,  // prisma — should not be reached past the IMMEDIATE guard
            {} as never,
            {} as never,
            {} as never,
            jobRepository as never,
            {} as never,
        );

        const greetingRule = createRule({
            id: "rule-greeting-new",
            eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
            offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
        });

        // Call the private method directly — IMMEDIATE guard must return before touching DB
        await (service as unknown as ServiceInternals).rebuildJobsForRule(branchId, greetingRule, false);

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("maps the service information name variable from the client name", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "김지니",
            phone: "010-1234-5678",
            type: "A가1형",
            startDate: new Date("2026-06-12T00:00:00.000Z"),
            endDate: null,
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
        });

        expect(variables).toEqual({
            name: "김지니",
            clientName: "김지니",
            phone: "010-1234-5678",
        });
    });

    it("maps CLIENT_GREETING template variables from the client", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
            offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "김산모",
            phone: "010-9999-0000",
            type: null,
            startDate: null,
            endDate: null,
            createdAt: new Date("2026-06-27T00:00:00.000Z"),
        });

        expect(variables).toEqual({
            name: "김산모",
            clientName: "김산모",
            phone: "010-9999-0000",
        });
    });

    it("maps PRICE_INFO template variables including price/bank fields (data-minimization scoping)", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.PRICE_INFO,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "이고객",
            phone: "010-5555-6666",
            type: "B형",
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: null,
            createdAt: null,
            fullPrice: "3000000",
            grant: "2000000",
            actualPrice: "1000000",
            area: { bankAccountInfo: { bankName: "신한은행", accNum: "110-123-456789" } },
        });

        expect(variables).toEqual({
            name: "이고객",
            clientName: "이고객",
            phone: "010-5555-6666",
            weeks: "0",
            duration: "",
            type: "B형",
            fullPrice: "3000000",
            grant: "2000000",
            actualPrice: "1000000",
            bankName: "신한은행",
            accNum: "110-123-456789",
        });
    });

    const createSyncService = () => {
        const ruleRepository = {
            findAll: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const jobRepository = {
            upsertPending: jest.fn().mockResolvedValue(undefined),
            findPendingByRuleIdsAndClientId: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const prisma = {
            client: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 1,
                    name: "김산모",
                    phone: "010-1234-5678",
                    type: null,
                    startDate: null,
                    endDate: null,
                    createdAt: new Date("2026-06-27T00:00:00.000Z"),
                }),
            },
        };
        const service = new AlimtalkTriggerService(
            prisma as never,
            {} as never,
            {} as never,
            ruleRepository as never,
            jobRepository as never,
            {} as never,
        );
        return { service, ruleRepository, jobRepository, prisma };
    };

    it("drops the IMMEDIATE greeting on re-sync (includePast=false) but fires it on create (includePast=true)", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
            offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
        });

        // Re-sync path (client update / due-date scheduler): greeting must be dropped.
        const reSync = createSyncService();
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        await reSync.service.syncClientRulesForClient(branchId, 1, false);
        expect(reSync.jobRepository.upsertPending).not.toHaveBeenCalled();

        // Create path: greeting must fire exactly once.
        const create = createSyncService();
        create.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        await create.service.syncClientRulesForClient(branchId, 1, true);
        expect(create.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
    });

    it("does not re-create the CLIENT_GREETING default when a non-default (AFTER_DAYS) greeting rule already exists", async () => {
        const { service, ruleRepository, internals } = createService();

        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        });
        // Admin-created greeting rule with a NON-default offset (AFTER_DAYS, not IMMEDIATE).
        const existingGreetingAfterDays = createRule({
            id: "rule-greeting-after-days",
            eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
            offsetType: AlimtalkTriggerOffsetType.AFTER_DAYS,
            offsetDays: 3,
            templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo, existingGreetingAfterDays]);

        await service.listRules(branchId);

        // The IMMEDIATE greeting default must NOT be auto-created — that would yield two
        // active greeting rules and double-greet every new client.
        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
    });
});
