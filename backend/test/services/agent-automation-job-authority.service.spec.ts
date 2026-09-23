import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";

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
