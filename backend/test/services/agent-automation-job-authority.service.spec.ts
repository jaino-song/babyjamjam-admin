import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { buildClientMessageRecipe, type ClientTriggerSource } from "application/services/message-trigger-recipes";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

/**
 * BJJ-342: SERVICE_END_NOTICE branch-rule jobs must reach the normal automatic
 * authority path instead of being refused early as manual, while jobs against
 * the branchless system manual row must still short-circuit before authority
 * is ever consulted.
 */
describe("AgentAutomationJobAuthorityService.checkAutomaticJob ownership gate", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const branchRuleId = "30000000-0000-4000-8000-000000009999";
    const jobId = "40000000-0000-4000-8000-000000009999";

    const buildScheduledBranchJob = () => MessageTriggerJobEntity.reconstitute(
        jobId,
        branchId,
        branchRuleId,
        "pending",
        new Date("2026-09-16T03:00:00.000Z"),
        null,
        null,
        null,
        42,
        null,
        MessageTriggerRecipientType.CLIENT,
        "010-1234-5678",
        MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        // No :manual: marker: this is the buildClientMessageRecipe dedupe shape
        // for a scheduled branch-rule job, not a manual-send job.
        `${branchRuleId}:client:42:CLIENT:2026-09-16T03:00:00.000Z`,
        { memberId: "client:42", recipientName: "김산모", recipientPhone: "010-1234-5678", templateVariables: {} },
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
    );

    const buildManualSystemRowJob = () => MessageTriggerJobEntity.reconstitute(
        jobId,
        branchId,
        SERVICE_END_NOTICE_RULE_ID,
        "pending",
        new Date("2026-09-16T03:00:00.000Z"),
        null,
        null,
        null,
        42,
        null,
        MessageTriggerRecipientType.CLIENT,
        "010-1234-5678",
        MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        `${SERVICE_END_NOTICE_RULE_ID}:client:42:manual:11111111-1111-4111-8111-111111111111`,
        { memberId: "client:42", recipientName: "김산모", recipientPhone: "010-1234-5678", templateVariables: {} },
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
    );

    const buildService = (checkImpl: jest.Mock) => {
        const authority = { check: checkImpl };
        const sources = {};
        const sender = {};
        const service = new AgentAutomationJobAuthorityService(
            authority as never,
            sources as never,
            sender as never,
        );
        return { service, authority };
    };

    const render = jest.fn();

    it("does not refuse a scheduled SERVICE_END_NOTICE branch-rule job as manual — it reaches the normal automatic authority path", async () => {
        const job = buildScheduledBranchJob();
        const transaction = {
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(job) },
        };
        const authorized = { status: "allowed", seal: { version: 1 } };
        const check = jest.fn().mockResolvedValue(authorized);
        const { service, authority } = buildService(check);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(authority.check).toHaveBeenCalledTimes(1);
        const [, input] = authority.check.mock.calls[0]!;
        expect(input.target).toEqual(expect.objectContaining({
            branchId, clientId: 42, kind: "client-rule", ruleId: branchRuleId, scheduleId: null, recipientType: "client",
        }));
        // Pass-through: the ownership gate did not intercept the call with its own refusal.
        expect(result).toBe(authorized);
    });

    it("is refused via the normal authority path (not the manual short-circuit) when authority is not bound", async () => {
        const job = buildScheduledBranchJob();
        const transaction = {
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(job) },
        };
        const refused = { status: "refused", reason: "automation-consent-denied" };
        const check = jest.fn().mockResolvedValue(refused);
        const { service, authority } = buildService(check);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(authority.check).toHaveBeenCalledTimes(1);
        expect(result).toBe(refused);
    });

    it("still refuses a manual SERVICE_END_NOTICE job against the system row before ever consulting authority", async () => {
        const job = buildManualSystemRowJob();
        const transaction = {
            message_trigger_job: { findFirst: jest.fn() },
        };
        const check = jest.fn();
        const { service, authority } = buildService(check);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(authority.check).not.toHaveBeenCalled();
        expect(transaction.message_trigger_job.findFirst).not.toHaveBeenCalled();
        expect(result).toEqual({ status: "refused", reason: "automation-authority-unavailable" });
    });
});

/**
 * BJJ-342 M1: the "grandfathered" comparison inside `describeCurrentClientEffect`
 * compares the job's (enriched) source payload against the fresh
 * `buildClientMessageRecipe` payload, which never contains a receipt link. An
 * enriched SERVICE_END_NOTICE job must still match its recipe now that the
 * enricher-owned fields are excluded from the bound source payload.
 */
describe("AgentAutomationJobAuthorityService.checkAutomaticJob grandfathered comparison for SERVICE_END_NOTICE (BJJ-342 M1)", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const ruleId = "50000000-0000-4000-8000-000000005555";
    const jobId = "40000000-0000-4000-8000-000000009999";
    const clientId = 42;
    const clientIdentity = "d".repeat(64);

    const client: ClientTriggerSource = {
        id: clientId,
        name: "김산모",
        phone: "01012345678",
        type: null,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-09-01T00:00:00.000Z"),
        serviceEndNoticeSentAt: null,
    };

    const rule = MessageTriggerRuleEntity.reconstitute(
        ruleId,
        branchId,
        "서비스 종료 안내",
        true,
        MessageTriggerEventType.SERVICE_END,
        MessageTriggerOffsetType.SAME_DAY,
        0,
        MessageTriggerRecipientType.CLIENT,
        MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
    );

    // The real recipe builder is the source of truth for scheduledFor/dedupeKey math
    // (KST calendar offsets); deriving the job's fields from it keeps this test from
    // having to reimplement that math and guarantees internal consistency.
    const recipe = buildClientMessageRecipe(rule, client, new Date("2026-09-01T00:00:00.000Z"));
    if (!recipe) throw new Error("test setup: recipe must build");

    function buildEnrichedJob(): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            jobId,
            branchId,
            ruleId,
            "processing",
            recipe!.scheduledFor,
            null,
            null,
            null,
            clientId,
            null,
            MessageTriggerRecipientType.CLIENT,
            recipe!.recipientPhone ?? null,
            MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            recipe!.dedupeKey,
            {
                ...recipe!.payload,
                templateVariables: {
                    ...recipe!.payload.templateVariables,
                    // ReceiptLinkDeliveryEnricher's mutation: neither field exists
                    // in the freshly-built recipe.
                    receiptUrl: "https://example.test/receipt/efr_abc123",
                },
                buttonUrl: "https://example.test/receipt/efr_abc123",
            },
            new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
        );
    }

    const settings = {
        status: "available" as const,
        rules: [rule],
        defaultsPresent: true,
        dispatchEnabled: true,
        senderApproved: true,
        senderApprovedAt: new Date("2026-01-01T00:00:00.000Z"),
        pastTriggerEnabled: false,
        pastTriggerConfig: { sendIntervalMinutes: 10 },
    };

    const snapshot = {
        templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        receiver: "01012345678",
        snapshotHash: "s".repeat(64),
    };

    function buildService(job: MessageTriggerJobEntity) {
        const check = jest.fn(async (_tx: unknown, input: { target: unknown }, describe: (arg: unknown) => Promise<unknown>) => {
            const effect = await describe({
                scope: { ...(input.target as object), clientIdentity, scheduleIdentity: null },
                subject: { kind: "client", clientId, clientIdentity },
                change: "create",
            });
            return effect
                ? { status: "allowed", seal: { version: 1 } }
                : { status: "refused", reason: "automation-consent-denied" };
        });
        const sources = {
            readClientAutomationSettings: jest.fn().mockResolvedValue(settings),
            readClientAutomationSource: jest.fn().mockResolvedValue(client),
        };
        const sender = { read: jest.fn().mockReturnValue({ availability: "available", identityDigest: "e".repeat(64) }) };
        const service = new AgentAutomationJobAuthorityService({ check } as never, sources as never, sender as never);
        const transaction = { message_trigger_job: { findFirst: jest.fn().mockResolvedValue(job) } };
        const render = jest.fn().mockResolvedValue(snapshot);
        return { service, transaction, render };
    }

    it("matches the recipe (allowed) once the receipt-link fields are excluded from the bound comparison", async () => {
        const job = buildEnrichedJob();
        const { service, transaction, render } = buildService(job);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(result).toEqual({ status: "allowed", seal: { version: 1 } });
    });

    it("still refuses when a non-link field is tampered (the exclusion is scoped to the two enricher keys only)", async () => {
        const job = buildEnrichedJob();
        job.payload.templateVariables["name"] = "다른이름";
        const { service, transaction, render } = buildService(job);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(result).toEqual({ status: "refused", reason: "automation-consent-denied" });
    });
});
