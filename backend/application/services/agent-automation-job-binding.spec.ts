import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentAutomationConcreteJobDigest } from "./agent-automation-job-binding";

const branchId = "11111111-1111-4111-8111-111111111111";
const jobId = "33333333-3333-4333-8333-333333333333";

function job(templateKey: MessageTriggerTemplateKey, ruleId = "system:service_end_notice"): MessageTriggerJobEntity {
    return MessageTriggerJobEntity.reconstitute(
        jobId,
        branchId,
        ruleId,
        "processing",
        new Date("2026-09-18T00:00:00.000Z"),
        null,
        null,
        null,
        7,
        null,
        MessageTriggerRecipientType.CLIENT,
        "01012345678",
        templateKey,
        `${ruleId}:client:7:2026-09-18`,
        {
            clientId: 7,
            memberId: "7",
            recipientName: "테스트",
            recipientPhone: "01012345678",
            templateVariables: { name: "테스트" },
        },
        new Date("2026-09-17T00:00:00.000Z"),
        new Date("2026-09-18T00:00:00.000Z"),
        1,
        null,
        null,
    );
}

describe("agentAutomationConcreteJobDigest", () => {
    it("keeps the SERVICE_END_NOTICE digest unchanged when the receipt-link enricher adds its fields", () => {
        const before = job(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        const beforeDigest = agentAutomationConcreteJobDigest(before);

        const after = job(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        after.payload.templateVariables["receiptUrl"] = "https://example.test/receipt/efr_abc123";
        after.payload.buttonUrl = "https://example.test/receipt/efr_abc123";
        const afterDigest = agentAutomationConcreteJobDigest(after);

        expect(afterDigest).toBe(beforeDigest);
    });

    it("does NOT exclude the same keys for another template", () => {
        const before = job(MessageTriggerTemplateKey.CLIENT_GREETING, "client-rule");
        const beforeDigest = agentAutomationConcreteJobDigest(before);

        const after = job(MessageTriggerTemplateKey.CLIENT_GREETING, "client-rule");
        after.payload.templateVariables["receiptUrl"] = "https://example.test/receipt/efr_abc123";
        after.payload.buttonUrl = "https://example.test/receipt/efr_abc123";
        const afterDigest = agentAutomationConcreteJobDigest(after);

        expect(afterDigest).not.toBe(beforeDigest);
    });

    it("still changes the SERVICE_END_NOTICE digest when any other field changes", () => {
        const before = job(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        const beforeDigest = agentAutomationConcreteJobDigest(before);

        const changedName = job(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        changedName.payload.templateVariables["name"] = "다른이름";
        expect(agentAutomationConcreteJobDigest(changedName)).not.toBe(beforeDigest);

        const changedPhone = job(MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        changedPhone.recipientPhone = "01099998888";
        expect(agentAutomationConcreteJobDigest(changedPhone)).not.toBe(beforeDigest);
    });
});
