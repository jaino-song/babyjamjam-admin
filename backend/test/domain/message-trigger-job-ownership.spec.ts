import { isManualMessageTriggerJob, isManualMessageTriggerRule } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";

describe("message trigger ownership", () => {
    it.each([
        ["agent-sms:branch", "INFO", "agent-sms:approved-immediate"],
        ["agent-sms:branch", "INFO", "agent-sms:approved-scheduled"],
        ["agent-sms:branch", "INFO", "agent-sms-retry:approved-retry"],
        ["original-automatic-rule", "INFO", "agent-sms-retry:approved-retry"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary:manual:11111111-1111-4111-8111-111111111111"],
        // Manual-send receipt job: system rule row + the exact dedupe shape
        // ReceiptLinkManualSendService.send produces (BJJ-342).
        [SERVICE_END_NOTICE_RULE_ID, "SERVICE_END_NOTICE", `${SERVICE_END_NOTICE_RULE_ID}:client:7:manual:11111111-1111-4111-8111-111111111111`],
    ])("preserves manual job %s / %s / %s", (ruleId, templateKey, dedupeKey) => {
        expect(isManualMessageTriggerJob({ ruleId, templateKey, dedupeKey })).toBe(true);
    });

    it.each([
        ["ordinary-rule", "INFO", "agent-sms:untrusted-dedupe"],
        ["not-agent-sms:branch", "INFO", "ordinary"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary:manual:not-a-uuid"],
        // Scheduled receipt job created from a branch SERVICE_END_NOTICE rule
        // (buildClientMessageRecipe's dedupe shape, no :manual: marker) is now
        // owned by automation, not the system manual row (BJJ-342).
        ["receipt-rule", "SERVICE_END_NOTICE", "receipt-rule:client:7:CLIENT:2026-09-16T03:00:00.000Z"],
        // Same system rule id but missing the manual marker/uuid shape entirely:
        // still not a manual job under the strict AND match.
        [SERVICE_END_NOTICE_RULE_ID, "SERVICE_END_NOTICE", `${SERVICE_END_NOTICE_RULE_ID}:client:7:CLIENT:2026-09-16T03:00:00.000Z`],
    ])("keeps automatic job %s / %s / %s under its parent", (ruleId, templateKey, dedupeKey) => {
        expect(isManualMessageTriggerJob({ ruleId, templateKey, dedupeKey })).toBe(false);
    });

    it("excludes the agent marker from parent normalization but retains the mixed service-record rule", () => {
        expect(isManualMessageTriggerRule({ id: "agent-sms:branch", templateKey: "INFO" })).toBe(true);
        expect(isManualMessageTriggerRule({ id: "system:service_record_link", templateKey: "SERVICE_RECORD_LINK" })).toBe(false);
    });

    it("classifies SERVICE_END_NOTICE rule ownership by rule id, not template key (BJJ-342)", () => {
        // The system row is always manual...
        expect(isManualMessageTriggerRule({ id: SERVICE_END_NOTICE_RULE_ID, templateKey: "SERVICE_END_NOTICE" })).toBe(true);
        // ...but a branch rule using the same template is automatic, just like the
        // service-record-link precedent.
        expect(isManualMessageTriggerRule({ id: "branch-rule-1", templateKey: "SERVICE_END_NOTICE" })).toBe(false);
    });
});
