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

    describe("readJobRuleRetryPermission (current value at finalization)", () => {
        const readWith = async (findUnique: jest.Mock) => {
            const service = new MessageAutomationActivationService(
                { message_trigger_job: { findUnique } } as unknown as MessageAutomationDatabase,
                {} as MessageAutomationBranchLockService,
                {} as AdminAuditEventWriter,
            );
            return service.readJobRuleRetryPermission(branchId, jobId);
        };

        it.each([
            ["on", { retryOnFailure: true }, "on"],
            ["off", { retryOnFailure: false }, "off"],
            ["a pre-migration row without the column", {}, "on"],
        ])("answers %s from the job's rule row", async (_name, rule, expected) => {
            const findUnique = jest.fn().mockResolvedValue({ branchId, rule });

            await expect(readWith(findUnique)).resolves.toBe(expected);
            expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: jobId } }));
        });

        it("answers rule-missing when the rule row or the job is gone", async () => {
            await expect(readWith(jest.fn().mockResolvedValue({ branchId, rule: null }))).resolves.toBe("rule-missing");
            await expect(readWith(jest.fn().mockResolvedValue(null))).resolves.toBe("rule-missing");
        });

        it("rejects on a failed read instead of answering", async () => {
            await expect(readWith(jest.fn().mockRejectedValue(new Error("db down")))).rejects.toThrow("db down");
        });
    });
});

describe("MessageAutomationActivationService branch override writes (no-op writes stay quiet)", () => {
    const branchId = "20000000-0000-4000-8000-000000009701";
    const ruleId = "30000000-0000-4000-8000-000000009701";
    const actor = { userId: "10000000-0000-4000-8000-000000009701", globalRole: "owner" };
    const globalRule = {
        id: ruleId,
        branchId: null,
        name: "Global notice",
        isActive: true,
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 1,
        sendTime: "09:00",
        recipientType: "CLIENT",
        templateKey: "SERVICE_INFO",
        isDefault: false,
        jobsStale: false,
        createdAt: new Date("2026-09-16T00:00:00Z"),
        updatedAt: new Date("2026-09-16T00:00:00Z"),
    };

    /** `stored` is the branch override row as it exists before the call (undefined = no row). */
    const build = (stored: { isActive: boolean } | undefined, jobRows: Array<Record<string, unknown>> = []) => {
        let current = stored;
        const audit = { append: jest.fn().mockResolvedValue(undefined) };
        const transaction = {
            // 1st raw read = lockAutomaticRules, every later one = the job lock inside cancelRuleJobs.
            $queryRaw: jest.fn().mockResolvedValueOnce([globalRule]).mockResolvedValue(jobRows),
            system_setting: { findUnique: jest.fn().mockResolvedValue({ value: "true" }) },
            message_trigger_rule: { findUnique: jest.fn(async () => ({ ...globalRule })) },
            message_trigger_job: { update: jest.fn().mockResolvedValue(undefined) },
            message_trigger_rule_branch_override: {
                // Stateful, like the table: a write is visible to the effective-rule read that follows it.
                findUnique: jest.fn(async () => (current ? { ...current } : null)),
                upsert: jest.fn(async ({ create }: { create: { isActive: boolean } }) => {
                    current = { isActive: create.isActive };
                }),
            },
        };
        const service = new MessageAutomationActivationService(
            {} as MessageAutomationDatabase,
            { runExclusive: jest.fn((_branch, work) => work(transaction)) } as unknown as MessageAutomationBranchLockService,
            audit as unknown as AdminAuditEventWriter,
        );
        return { service, transaction, audit };
    };

    describe("setGlobalRuleBranchActivation", () => {
        it("writes nothing when the stored override already equals the target, yet still cancels the rule's jobs", async () => {
            const { service, transaction } = build({ isActive: false }, [
                { id: "job-1", status: "pending", cancel_reason: null },
            ]);

            await service.setGlobalRuleBranchActivation(branchId, ruleId, false, actor);

            expect(transaction.message_trigger_rule_branch_override.upsert).not.toHaveBeenCalled();
            // cancelRuleJobs still ran: its job lock was read and the pending job was cancelled.
            expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
            expect(transaction.message_trigger_job.update).toHaveBeenCalledTimes(1);
        });

        it("writes the override exactly once and audits the change when the stored value differs", async () => {
            const { service, transaction, audit } = build({ isActive: true });

            await service.setGlobalRuleBranchActivation(branchId, ruleId, false, actor);

            expect(transaction.message_trigger_rule_branch_override.upsert).toHaveBeenCalledTimes(1);
            expect(transaction.message_trigger_rule_branch_override.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { branchId_ruleId: { branchId, ruleId } },
                create: { branchId, ruleId, isActive: false },
                update: expect.objectContaining({ isActive: false }),
            }));
            expect(audit.append).toHaveBeenCalledTimes(1);
        });

        it("creates the override once when no row exists", async () => {
            const { service, transaction } = build(undefined);

            await service.setGlobalRuleBranchActivation(branchId, ruleId, true, actor);

            expect(transaction.message_trigger_rule_branch_override.upsert).toHaveBeenCalledTimes(1);
            expect(transaction.message_trigger_rule_branch_override.upsert).toHaveBeenCalledWith(expect.objectContaining({
                create: { branchId, ruleId, isActive: true },
            }));
        });

        it("writes nothing when re-activating an override that is already on", async () => {
            const { service, transaction } = build({ isActive: true });

            await service.setGlobalRuleBranchActivation(branchId, ruleId, true, actor);

            expect(transaction.message_trigger_rule_branch_override.upsert).not.toHaveBeenCalled();
        });
    });

    describe("normalizeBranchOff", () => {
        const run = async (stored: { isActive: boolean } | undefined) => {
            const { service, transaction } = build(stored);
            transaction.$queryRaw.mockReset();
            transaction.$queryRaw.mockResolvedValue([]);
            await service.normalizeBranchOff(branchId, transaction as never, [globalRule as never]);
            return transaction;
        };

        it("does not rewrite a global rule's override that is already off", async () => {
            const transaction = await run({ isActive: false });

            expect(transaction.message_trigger_rule_branch_override.upsert).not.toHaveBeenCalled();
        });

        it("turns the override off exactly once when it is missing", async () => {
            const transaction = await run(undefined);

            expect(transaction.message_trigger_rule_branch_override.upsert).toHaveBeenCalledTimes(1);
            expect(transaction.message_trigger_rule_branch_override.upsert).toHaveBeenCalledWith(expect.objectContaining({
                create: { branchId, ruleId, isActive: false },
            }));
        });

        it("turns the override off exactly once when it is on", async () => {
            const transaction = await run({ isActive: true });

            expect(transaction.message_trigger_rule_branch_override.upsert).toHaveBeenCalledTimes(1);
        });
    });
});
