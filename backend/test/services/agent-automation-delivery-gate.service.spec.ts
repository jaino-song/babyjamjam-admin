import { AgentAutomationDeliveryGateService, type AutomationDeliveryFence } from "application/services/agent-automation-delivery-gate.service";
import type { CanonicalAutomationRenderer } from "application/services/agent-automation-job-authority.service";
import type { SmsTriggerDeliveryPreparation, SmsTriggerDeliverySnapshot } from "application/services/sms-trigger-delivery.service";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "domain/constants/sms-delivery-snapshot";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";

/**
 * BJJ-342: permitsDirectManualJob must reject a scheduled branch-rule
 * SERVICE_END_NOTICE job (it belongs to the automation authority path, not
 * direct manual delivery) while still admitting an actual manual-send job
 * against the branchless system rule row.
 */
describe("AgentAutomationDeliveryGateService.permitsDirectManualJob ownership gate (BJJ-342)", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const branchRuleId = "30000000-0000-4000-8000-000000009999";
    const jobId = "40000000-0000-4000-8000-000000009999";
    const claimToken = "claim-token-1";

    const buildScheduledBranchJob = () => MessageTriggerJobEntity.reconstitute(
        jobId,
        branchId,
        branchRuleId,
        "processing",
        new Date("2026-09-16T03:00:00.000Z"),
        null,
        null,
        null,
        42,
        null,
        MessageTriggerRecipientType.CLIENT,
        "010-1234-5678",
        MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        // No :manual: marker: the buildClientMessageRecipe dedupe shape for a
        // scheduled branch-rule job, not a manual-send job.
        `${branchRuleId}:client:42:CLIENT:2026-09-16T03:00:00.000Z`,
        { memberId: "client:42", recipientName: "김산모", recipientPhone: "010-1234-5678", templateVariables: {} },
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
        0,
        null,
        claimToken,
    );

    const buildManualSendJob = () => MessageTriggerJobEntity.reconstitute(
        jobId,
        branchId,
        SERVICE_END_NOTICE_RULE_ID,
        "processing",
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
        0,
        null,
        claimToken,
    );

    const buildGate = (findFirstResult: unknown) => {
        const database = { message_trigger_job: { findFirst: jest.fn().mockResolvedValue(findFirstResult) } };
        const lock = {};
        const authority = {};
        const gate = new AgentAutomationDeliveryGateService(database as never, lock as never, authority as never);
        return { gate, database };
    };

    it("refuses direct-manual admission for a scheduled branch-rule SERVICE_END_NOTICE job", async () => {
        const job = buildScheduledBranchJob();
        const { gate, database } = buildGate(job);

        const result = await gate.permitsDirectManualJob(job, "processing");

        expect(result).toBe(false);
        // Ownership refusal short-circuits before any store lookup is attempted.
        expect(database.message_trigger_job.findFirst).not.toHaveBeenCalled();
    });

    it("still admits a real manual-send job against the system rule row", async () => {
        const job = buildManualSendJob();
        const { gate, database } = buildGate(job);

        const result = await gate.permitsDirectManualJob(job, "processing");

        expect(result).toBe(true);
        expect(database.message_trigger_job.findFirst).toHaveBeenCalledWith({
            where: { id: jobId, branchId, claimToken, status: "processing" },
        });
    });
});

/**
 * BJJ-342 M1: an automatic SERVICE_END_NOTICE job admitted under authority
 * "allowed" must survive `ReceiptLinkDeliveryEnricher` overwriting
 * `templateVariables.receiptUrl` / `buttonUrl` between admission and dispatch
 * -- the binding now excludes those two enricher-owned fields for this
 * template only. Tampering any OTHER field after admission must still be
 * caught and canceled.
 */
describe("AgentAutomationDeliveryGateService automatic SERVICE_END_NOTICE dispatch survives receipt-link enrichment (BJJ-342 M1)", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const ruleId = "30000000-0000-4000-8000-000000009999";
    const jobId = "40000000-0000-4000-8000-000000009999";
    const claimToken = "claim-token-1";
    const scheduledFor = new Date("2026-09-16T03:00:00.000Z");
    const dedupeKey = `${ruleId}:client:42:CLIENT:2026-09-16T03:00:00.000Z`;

    const seal = {
        version: 1,
        authorityId: "22222222-2222-4222-8222-222222222222",
        authorityDigest: "b".repeat(64),
        scope: {
            branchId, clientId: 42, clientIdentity: "b".repeat(64), kind: "client-rule",
            ruleId, scheduleId: null, scheduleIdentity: null, recipientType: "client",
        },
        memberDigest: "b".repeat(64),
        reviewedEffectDigest: "b".repeat(64),
        concreteJobDigest: "c".repeat(64),
    } as unknown as import("domain/entities/agent-automation-consent").AgentAutomationJobSeal;

    const snapshot: SmsTriggerDeliverySnapshot = {
        templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        receiver: "01012345678",
        maskedReceiver: "010****5678",
        recipientName: "김산모",
        message: "본인부담금 영수증 안내",
        title: "서비스 종료 안내",
        requestedDeliveryType: "AUTO",
        deliveryType: "LMS",
        estimatedCost: "0",
        templateVersion: "v1",
        templateHash: "h".repeat(64),
        configVersion: "sms-template-delivery-v1",
        configHash: "h".repeat(64),
        snapshotHash: "s".repeat(64),
    };

    function buildJob(): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            jobId,
            branchId,
            ruleId,
            "processing",
            scheduledFor,
            null,
            null,
            null,
            42,
            null,
            MessageTriggerRecipientType.CLIENT,
            "01012345678",
            MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            dedupeKey,
            {
                clientId: 42,
                memberId: "client:42",
                recipientName: "김산모",
                recipientPhone: "01012345678",
                templateVariables: { name: "김산모", clientName: "김산모", phone: "01012345678" },
                agentAutomationSeal: seal,
            },
            new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
            0,
            null,
            claimToken,
        );
    }

    /** A minimal fake store that tracks exactly the row fields the gate reads/writes. */
    function buildStore(job: MessageTriggerJobEntity) {
        let status: "processing" | "dispatching" | "canceled" = "processing";
        const toRow = () => ({
            id: job.id, branchId: job.branchId, ruleId: job.ruleId, clientId: job.clientId,
            employeeScheduleId: job.employeeScheduleId, scheduledFor: job.scheduledFor, dedupeKey: job.dedupeKey,
            recipientPhone: job.recipientPhone, recipientType: job.recipientType, templateKey: job.templateKey,
            payload: job.payload, claimToken: job.claimToken, status,
        });
        const findFirst = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
            if (where["status"] !== undefined && where["status"] !== status) return null;
            if (where["id"] !== job.id || where["branchId"] !== job.branchId) return null;
            if (where["claimToken"] !== undefined && where["claimToken"] !== job.claimToken) return null;
            return toRow();
        });
        const updateMany = jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            if (where["status"] !== status || where["claimToken"] !== job.claimToken) return { count: 0 };
            status = data["status"] as typeof status;
            return { count: 1 };
        });
        return {
            table: { findFirst, updateMany },
            markDispatching: () => { status = "dispatching"; },
            get status() { return status; },
        };
    }

    it("allows dispatch after the enricher overwrites templateVariables.receiptUrl and buttonUrl", async () => {
        const job = buildJob();
        const store = buildStore(job);
        const database = { message_trigger_job: store.table };
        const lock = { runExclusive: jest.fn((_branchId: string, fn: (tx: unknown) => unknown) => fn(database)) };
        const authority = { checkAutomaticJob: jest.fn().mockResolvedValue({ status: "allowed", seal }) };
        const gate = new AgentAutomationDeliveryGateService(database as never, lock as never, authority as never);

        const fence: AutomationDeliveryFence = { kind: "allow" };
        const render: CanonicalAutomationRenderer = jest.fn().mockResolvedValue(snapshot);

        const prep = await gate.authorizePreparation(job, render, async () => fence);
        expect(prep).toEqual({ kind: "allow" });
        expect(await gate.consumePreparation(job)).toBe(true);

        // Simulate persistPreparedDelivery (stamps the private snapshot variable)
        // followed by ReceiptLinkDeliveryEnricher.enrich() overwriting the
        // enricher-owned receipt-link fields -- exactly the sequence BJJ-342 M1
        // reported as fatal before the binding exclusion existed.
        const preparation: SmsTriggerDeliveryPreparation = { snapshot, serializedSnapshot: JSON.stringify(snapshot) };
        job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = preparation.serializedSnapshot;
        job.payload.templateVariables["receiptUrl"] = "https://example.test/receipt/efr_newtoken";
        job.payload.buttonUrl = "https://example.test/receipt/efr_newtoken";

        const dispatch = await gate.authorizeDispatch(job, preparation, render, async () => {
            store.markDispatching();
            return { kind: "allow" };
        });

        expect(dispatch).toEqual({ kind: "allow" });
        expect(store.status).toBe("dispatching");
    });

    it("control: tampering a non-link field after admission is NOT allowed", async () => {
        const job = buildJob();
        const store = buildStore(job);
        const database = { message_trigger_job: store.table };
        const lock = { runExclusive: jest.fn((_branchId: string, fn: (tx: unknown) => unknown) => fn(database)) };
        const authority = { checkAutomaticJob: jest.fn().mockResolvedValue({ status: "allowed", seal }) };
        const gate = new AgentAutomationDeliveryGateService(database as never, lock as never, authority as never);

        const fence: AutomationDeliveryFence = { kind: "allow" };
        const render: CanonicalAutomationRenderer = jest.fn().mockResolvedValue(snapshot);

        expect(await gate.authorizePreparation(job, render, async () => fence)).toEqual({ kind: "allow" });
        expect(await gate.consumePreparation(job)).toBe(true);

        const preparation: SmsTriggerDeliveryPreparation = { snapshot, serializedSnapshot: JSON.stringify(snapshot) };
        job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = preparation.serializedSnapshot;
        // Tamper a bound, non-enricher field: this must still change the digest.
        job.payload.templateVariables["name"] = "다른이름";

        const dispatch = await gate.authorizeDispatch(job, preparation, render, async () => {
            store.markDispatching();
            return { kind: "allow" };
        });

        expect(dispatch).not.toEqual({ kind: "allow" });
        expect(store.status).not.toBe("dispatching");
    });
});
