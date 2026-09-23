import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
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
