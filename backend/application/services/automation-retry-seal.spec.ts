import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentAutomationConcreteJobDigest } from "./agent-automation-job-binding";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { buildAutomationRetrySealVariables, readAutomationRetrySeal } from "./automation-retry-seal";

const branchId = "11111111-1111-4111-8111-111111111111";
const authorityId = "22222222-2222-4222-8222-222222222222";
const digest = "a".repeat(64);

function job(withSeal = true): MessageTriggerJobEntity {
    const value = MessageTriggerJobEntity.reconstitute(
        "33333333-3333-4333-8333-333333333333",
        branchId,
        "client-rule",
        "failed",
        new Date("2026-09-18T00:00:00.000Z"),
        null,
        null,
        "provider rejected",
        7,
        null,
        MessageTriggerRecipientType.CLIENT,
        "01012345678",
        MessageTriggerTemplateKey.CLIENT_GREETING,
        "client-rule:7:2026-09-18",
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
    if (!withSeal) return value;
    const concreteJobDigest = agentAutomationConcreteJobDigest(value);
    value.payload.agentAutomationSeal = {
        version: 1,
        authorityId,
        authorityDigest: digest,
        scope: {
            branchId,
            clientId: 7,
            clientIdentity: digest,
            kind: "client-rule",
            ruleId: "client-rule",
            scheduleId: null,
            scheduleIdentity: null,
            recipientType: "client",
        },
        memberDigest: digest,
        reviewedEffectDigest: digest,
        concreteJobDigest,
    };
    return value;
}

describe("automation retry seal", () => {
    it("keeps legacy jobs on the existing retry path", () => {
        expect(readAutomationRetrySeal(job(false), {})).toEqual({ kind: "legacy" });
    });

    it("fails closed when a sealed job loses its source seal but keeps durable association fields", () => {
        const current = job();
        const variables = buildAutomationRetrySealVariables(current, digest);
        delete current.payload.agentAutomationSeal;
        expect(readAutomationRetrySeal(current, variables)).toEqual(expect.objectContaining({ kind: "invalid" }));
    });

    it("round-trips only digest-only fields for a sealed job", () => {
        const current = job();
        const variables = buildAutomationRetrySealVariables(current, digest);
        expect(variables).toEqual(expect.objectContaining({
            automationAuthorityId: authorityId,
            automationAuthorityDigest: digest,
            automationConcreteJobDigest: expect.any(String),
            automationSnapshotHash: digest,
        }));
        expect(Object.keys(variables)).not.toContain("recipientPhone");
        expect(Object.keys(variables)).not.toContain("messageBody");
        expect(readAutomationRetrySeal(current, variables)).toEqual(expect.objectContaining({ kind: "valid", snapshotHash: digest }));
    });

    it.each([
        "automationAuthorityDigest",
        "automationSealDigest",
        "automationConcreteJobDigest",
        "automationSnapshotHash",
    ])("rejects a missing %s", (key) => {
        const current = job();
        const variables = buildAutomationRetrySealVariables(current, digest);
        delete variables[key];
        expect(readAutomationRetrySeal(current, variables)).toEqual(expect.objectContaining({ kind: "invalid" }));
    });

    it("rejects a retimed or copied job even when the old variables are copied", () => {
        const current = job();
        const variables = buildAutomationRetrySealVariables(current, digest);
        const copied = job();
        copied.scheduledFor = new Date("2026-09-19T00:00:00.000Z");
        expect(readAutomationRetrySeal(copied, variables)).toEqual(expect.objectContaining({ kind: "invalid" }));
        expect(agentBindingHash(variables)).not.toBe(agentBindingHash(buildAutomationRetrySealVariables(copied, digest)));
    });
});
