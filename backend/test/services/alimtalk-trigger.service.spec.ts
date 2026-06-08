import { AlimtalkTriggerService } from "application/services/alimtalk-trigger.service";
import {
    AlimtalkTriggerEventType,
    AlimtalkTriggerOffsetType,
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerRuleEntity } from "domain/entities/alimtalk-trigger-rule.entity";

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
                type: string | null;
                startDate: Date | null;
                endDate: Date | null;
                createdAt?: Date | null;
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
        const created = createRule({
            id: "rule-service-info",
            name: "서비스 시작 7일 전 서비스 안내",
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        });
        ruleRepository.findAll.mockResolvedValue([]);
        ruleRepository.create.mockResolvedValue(created);

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
        expect(internals.rebuildJobsForRule).toHaveBeenCalledWith(branchId, created, false);
        expect(rules).toEqual([created]);
    });

    it("does not duplicate an existing default service information trigger", async () => {
        const { service, internals, ruleRepository } = createService();
        const existing = createRule({
            id: "rule-existing-service-info",
            eventType: AlimtalkTriggerEventType.SERVICE_START,
            offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
        });
        ruleRepository.findAll.mockResolvedValue([existing]);

        await expect(service.listRules(branchId)).resolves.toEqual([existing]);

        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
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
            type: "A가1형",
            startDate: new Date("2026-06-12T00:00:00.000Z"),
            endDate: null,
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
        });

        expect(variables).toEqual({
            name: "김지니",
            clientName: "김지니",
        });
    });
});
