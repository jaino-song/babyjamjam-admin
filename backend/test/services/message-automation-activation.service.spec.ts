import { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";

describe("MessageAutomationActivationService send time", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const actor = { userId: "10000000-0000-4000-8000-000000009161", globalRole: "owner" };

    it.each([false, true])("preserves a custom time when activating a rule (global=%s)", async (global) => {
        const rule = {
            id: "30000000-0000-4000-8000-000000009161",
            branchId: global ? null : branchId,
            name: "Scheduled notice",
            isActive: global,
            eventType: "SERVICE_START",
            offsetType: "BEFORE_DAYS",
            offsetDays: 1,
            sendTime: "14:37",
            recipientType: "CLIENT",
            templateKey: "SERVICE_INFO",
            isDefault: false,
            jobsStale: false,
            createdAt: new Date("2026-09-16T00:00:00Z"),
            updatedAt: new Date("2026-09-16T00:00:00Z"),
        };
        let overrideActive = false;
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([rule]),
            system_setting: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
            message_trigger_rule: {
                findUnique: jest.fn(async () => ({ ...rule })),
                update: jest.fn(async ({ data }) => Object.assign(rule, data)),
            },
            message_trigger_rule_branch_override: {
                findUnique: jest.fn(async () => ({ isActive: overrideActive })),
                upsert: jest.fn(async ({ update }) => { overrideActive = update.isActive; }),
            },
        };
        const service = new MessageAutomationActivationService(
            {} as MessageAutomationDatabase,
            { runExclusive: jest.fn((_branch, work) => work(transaction)) } as unknown as MessageAutomationBranchLockService,
            { append: jest.fn().mockResolvedValue(undefined) } as unknown as AdminAuditEventWriter,
        );
        const activated = global
            ? await service.setGlobalRuleBranchActivation(branchId, rule.id, true, actor)
            : await service.activateRuleWithParent(branchId, rule.id, { actor });

        expect(activated.isActive).toBe(true);
        expect(activated.sendTime).toBe("14:37");
        expect(rule.sendTime).toBe("14:37");
        const selection = transaction.$queryRaw.mock.calls[0][0] as Prisma.Sql;
        expect(selection.sql).toContain('send_time AS "sendTime"');
    });
});

describe("MessageAutomationActivationService SERVICE_END_NOTICE ownership (BJJ-342)", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const actor = { userId: "10000000-0000-4000-8000-000000009161", globalRole: "owner" };

    const buildTransaction = (rule: Record<string, unknown>) => {
        let overrideActive = false;
        return {
            $queryRaw: jest.fn().mockResolvedValue([rule]),
            system_setting: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
            message_trigger_rule: {
                findUnique: jest.fn(async () => ({ ...rule })),
                update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(rule, data)),
            },
            message_trigger_rule_branch_override: {
                findUnique: jest.fn(async () => ({ isActive: overrideActive })),
                upsert: jest.fn(async ({ update }: { update: { isActive: boolean } }) => { overrideActive = update.isActive; }),
            },
        };
    };

    const buildService = (transaction: unknown) => new MessageAutomationActivationService(
        {} as MessageAutomationDatabase,
        { runExclusive: jest.fn((_branch, work) => work(transaction)) } as unknown as MessageAutomationBranchLockService,
        { append: jest.fn().mockResolvedValue(undefined) } as unknown as AdminAuditEventWriter,
    );

    it("activates a branch SERVICE_END_NOTICE rule like any other automatic rule", async () => {
        const rule = {
            id: "30000000-0000-4000-8000-000000009162",
            branchId,
            name: "서비스 종료 안내",
            isActive: false,
            eventType: "SERVICE_END",
            offsetType: "SAME_DAY",
            offsetDays: 0,
            sendTime: null,
            recipientType: "CLIENT",
            templateKey: "SERVICE_END_NOTICE",
            isDefault: false,
            jobsStale: false,
            createdAt: new Date("2026-09-16T00:00:00Z"),
            updatedAt: new Date("2026-09-16T00:00:00Z"),
        };
        const transaction = buildTransaction(rule);
        const service = buildService(transaction);

        const activated = await service.activateRuleWithParent(branchId, rule.id, { actor });

        expect(activated.isActive).toBe(true);
        expect(transaction.message_trigger_rule.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: rule.id }, data: expect.objectContaining({ isActive: true }) }),
        );
    });

    it("still rejects the SERVICE_END_NOTICE system manual row", async () => {
        const systemRule = {
            id: SERVICE_END_NOTICE_RULE_ID,
            branchId: null,
            name: "서비스 종료 안내 (수동 발송)",
            isActive: true,
            eventType: "SERVICE_END",
            offsetType: "SAME_DAY",
            offsetDays: 0,
            sendTime: null,
            recipientType: "CLIENT",
            templateKey: "SERVICE_END_NOTICE",
            isDefault: false,
            jobsStale: false,
            createdAt: new Date("2026-09-16T00:00:00Z"),
            updatedAt: new Date("2026-09-16T00:00:00Z"),
        };
        const transaction = buildTransaction(systemRule);
        const service = buildService(transaction);

        await expect(service.activateRuleWithParent(branchId, SERVICE_END_NOTICE_RULE_ID, { actor }))
            .rejects.toThrow(BadRequestException);
        expect(transaction.message_trigger_rule.update).not.toHaveBeenCalled();
    });
});

describe("MessageAutomationActivationService automatic retry rule policy (규칙 메시지-04)", () => {
    const branchId = "20000000-0000-4000-8000-000000009444";
    const jobId = "40000000-0000-4000-8000-000000009444";
    const ruleId = "30000000-0000-4000-8000-000000009444";

    const run = async (ruleRow: Record<string, unknown>) => {
        const transaction = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([ruleRow])
                .mockResolvedValueOnce([{ id: jobId, branch_id: branchId, rule_id: ruleId, status: "failed", dedupe_key: `${ruleId}:client:7` }]),
            system_setting: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
            message_trigger_job: {
                findUnique: jest.fn().mockResolvedValue({
                    id: jobId, branchId, ruleId, status: "failed", templateKey: "SERVICE_INFO",
                    dedupeKey: `${ruleId}:client:7`, clientId: 7, rule: { id: ruleId },
                }),
            },
            message_trigger_rule_branch_override: { findUnique: jest.fn() },
        };
        const service = new MessageAutomationActivationService(
            {} as MessageAutomationDatabase,
            { runExclusive: jest.fn((_branch, work) => work(transaction)) } as unknown as MessageAutomationBranchLockService,
            { append: jest.fn().mockResolvedValue(undefined) } as unknown as AdminAuditEventWriter,
        );
        const work = jest.fn().mockResolvedValue("done");
        const result = await service.runAutomaticRetryIfEnabled(branchId, jobId, work);
        return { result, work, transaction };
    };
    const lockedRule = (extra: Record<string, unknown>) => ({
        id: ruleId, branch_id: branchId, is_active: true, template_key: "SERVICE_INFO", ...extra,
    });

    it("hands the retry boundary the CURRENT values of the locked rule row and the job's client", async () => {
        const { result, work, transaction } = await run(lockedRule({ target_client_status: "waiting", retry_on_failure: false }));

        expect(result).toEqual({ allowed: true, applies: true, value: "done" });
        expect(work).toHaveBeenCalledWith(transaction, { targetClientStatus: "waiting", retryOnFailure: false, clientId: 7 });
        const selection = transaction.$queryRaw.mock.calls[0][0] as Prisma.Sql;
        expect(selection.sql).toContain("target_client_status");
        expect(selection.sql).toContain("retry_on_failure");
        expect(selection.sql).toContain("FOR UPDATE");
    });

    it("treats a rule row without the columns as 전체 / 재전송 켬", async () => {
        const { work, transaction } = await run(lockedRule({}));

        expect(work).toHaveBeenCalledWith(transaction, { targetClientStatus: "all", retryOnFailure: true, clientId: 7 });
    });
});
