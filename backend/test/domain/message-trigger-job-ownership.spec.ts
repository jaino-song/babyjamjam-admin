import { isManualMessageTriggerJob, isManualMessageTriggerRule } from "domain/constants/message-trigger-job-ownership";

describe("message trigger ownership", () => {
    it.each([
        ["agent-sms:branch", "INFO", "agent-sms:approved-immediate"],
        ["agent-sms:branch", "INFO", "agent-sms:approved-scheduled"],
        ["agent-sms:branch", "INFO", "agent-sms-retry:approved-retry"],
        ["original-automatic-rule", "INFO", "agent-sms-retry:approved-retry"],
        ["receipt-rule", "SERVICE_END_NOTICE", "receipt:manual"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary:manual:11111111-1111-4111-8111-111111111111"],
    ])("preserves manual job %s / %s / %s", (ruleId, templateKey, dedupeKey) => {
        expect(isManualMessageTriggerJob({ ruleId, templateKey, dedupeKey })).toBe(true);
    });

    it.each([
        ["ordinary-rule", "INFO", "agent-sms:untrusted-dedupe"],
        ["not-agent-sms:branch", "INFO", "ordinary"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary"],
        ["system:service_record_link", "SERVICE_RECORD_LINK", "system:service_record_link:schedule:12:primary:manual:not-a-uuid"],
    ])("keeps automatic job %s / %s / %s under its parent", (ruleId, templateKey, dedupeKey) => {
        expect(isManualMessageTriggerJob({ ruleId, templateKey, dedupeKey })).toBe(false);
    });

    it("excludes the agent marker from parent normalization but retains the mixed service-record rule", () => {
        expect(isManualMessageTriggerRule({ id: "agent-sms:branch", templateKey: "INFO" })).toBe(true);
        expect(isManualMessageTriggerRule({ id: "system:service_record_link", templateKey: "SERVICE_RECORD_LINK" })).toBe(false);
    });
});
