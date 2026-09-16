import { Prisma } from "@prisma/client";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";

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
