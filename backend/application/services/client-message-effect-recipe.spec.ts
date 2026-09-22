import { createLegacyAutomationDeliveryGate } from "../../test/fixtures/legacy-automation-delivery-gate";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG } from "domain/entities/system-setting.entity";
import { agentAutomationEffectDigest } from "application/agent/agent-automation-consent";
import { describeClientMessageEffect, type ClientMessageEffectPolicy } from "./client-message-effect-recipe";
import { SmsTriggerDeliveryService } from "./sms-trigger-delivery.service";
import type { ClientTriggerSource } from "./message-trigger-recipes";

const branchId = "76000000-0000-4000-8000-000000000001";
const taskId = "76000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-17T00:00:00Z");
const policy: ClientMessageEffectPolicy = {
    dispatchEnabled: true, senderApproved: true, senderIdentityDigest: "a".repeat(64), senderApprovedAt: "2026-09-01T00:00:00.000Z",
    pastTriggerEnabled: true, pastTriggerConfig: DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
};
const client: ClientTriggerSource = {
    id: 0, name: "합성 고객", phone: "01000000021", type: "A통합1형", duration: 10,
    fullPrice: "100000", grant: "60000", actualPrice: "40000", serviceEndNoticeSentAt: null,
    startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-15T00:00:00Z"),
    area: { bankAccountInfo: { bankName: "합성 은행", accNum: "000000001" } },
};
function setup() {
    const rule = new MessageTriggerRuleEntity("rule-a", branchId, "합성 규칙", true,
        MessageTriggerEventType.CLIENT_CREATED, MessageTriggerOffsetType.IMMEDIATE, 0,
        MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.CLIENT_GREETING, now, now);
    const template = { id: "template-a", content: "{{name}}님 합성 안내", updatedAt: now, requiredVariables: [], customVariables: [] };
    const templates = { getByKeyForBranch: jest.fn().mockImplementation(async () => template) };
    const aligo = { sendSms: jest.fn() };
    const logs = { save: jest.fn(), update: jest.fn() };
    const enrichers = { enrich: jest.fn() };
    const delivery = new SmsTriggerDeliveryService(aligo as never, templates as never, logs as never, undefined, enrichers as never, createLegacyAutomationDeliveryGate());
    const input = { branchId, subject: { kind: "task-client" as const, taskId }, client, rule, policy, now,
        change: "create" as const, delivery };
    return { input, template, templates, aligo, logs, enrichers };
}

describe("read-only client message effect recipe", () => {
    it("uses the real canonical renderer but never sends, enriches or saves a job/log", async () => {
        const { input, templates, aligo, logs, enrichers } = setup();
        const result = await describeClientMessageEffect(input);
        expect(result.status).toBe("effect");
        expect(templates.getByKeyForBranch).toHaveBeenCalledTimes(1);
        expect(aligo.sendSms).not.toHaveBeenCalled();
        expect(logs.save).not.toHaveBeenCalled();
        expect(logs.update).not.toHaveBeenCalled();
        expect(enrichers.enrich).not.toHaveBeenCalled();
        for (const raw of [client.phone, client.name, "합성 안내", "000000001"]) expect(JSON.stringify(result)).not.toContain(raw);
    });

    it("keeps an immediate creation recipe stable across preview time and ephemeral numeric IDs", async () => {
        const { input } = setup();
        expect(await describeClientMessageEffect({ ...input, now: new Date(now.getTime() + 60_000), client: { ...client, id: 99 } }))
            .toEqual(await describeClientMessageEffect(input));
        input.rule.offsetType = MessageTriggerOffsetType.AFTER_DAYS;
        input.rule.offsetDays = 2;
        expect(await describeClientMessageEffect({ ...input, now: new Date(now.getTime() + 86_400_000) }))
            .toEqual(await describeClientMessageEffect(input));
    });

    it("binds calendar scheduling and known resource incarnation, rather than preview wall time", async () => {
        const { input } = setup();
        input.rule.eventType = MessageTriggerEventType.SERVICE_START;
        input.rule.offsetType = MessageTriggerOffsetType.BEFORE_DAYS;
        input.rule.offsetDays = 7;
        const first = await describeClientMessageEffect(input);
        expect(first.status).toBe("effect");
        expect(await describeClientMessageEffect({ ...input, client: { ...client, startDate: new Date("2026-10-02T00:00:00Z") } })).not.toEqual(first);
        const existing = { ...input, subject: { kind: "client" as const, clientId: 51, clientIdentity: "b".repeat(64) }, client: { ...client, id: 51 } };
        expect((await describeClientMessageEffect(existing)).status).toBe("effect");
        expect(await describeClientMessageEffect({ ...existing, subject: { ...existing.subject, clientIdentity: "c".repeat(64) } }))
            .not.toEqual(await describeClientMessageEffect(existing));
        expect(await describeClientMessageEffect({ ...existing, client: { ...client, id: 52 } }))
            .toEqual({ status: "unavailable", reason: "source-unavailable" });
    });

    it("changes the digest for recipient, rendered content, template version and provider/branch policy changes", async () => {
        const { input, template } = setup();
        const first = await describeClientMessageEffect(input);
        for (const changed of [
            { ...input, client: { ...client, phone: "01000000022" } },
            { ...input, client: { ...client, name: "합성 정정" } },
            { ...input, policy: { ...policy, senderIdentityDigest: "b".repeat(64) } },
            { ...input, policy: { ...policy, senderApprovedAt: "2026-09-02T00:00:00.000Z" } },
            { ...input, policy: { ...policy, pastTriggerEnabled: false } },
        ]) expect(await describeClientMessageEffect(changed)).not.toEqual(first);
        template.content = "변경된 합성 안내 {{name}}";
        expect(await describeClientMessageEffect(input)).not.toEqual(first);
        const contentChange = await describeClientMessageEffect(input);
        template.updatedAt = new Date(now.getTime() + 1000);
        expect(await describeClientMessageEffect(input)).not.toEqual(contentChange);
    });

    it("ignores customer fields not used by this template, but binds price/bank fields for PRICE_INFO", async () => {
        const { input, template } = setup();
        const changed = { ...client, fullPrice: "200000", area: { bankAccountInfo: { bankName: "다른 은행", accNum: "000000002" } } };
        expect(await describeClientMessageEffect({ ...input, client: changed })).toEqual(await describeClientMessageEffect(input));
        input.rule.templateKey = MessageTriggerTemplateKey.PRICE_INFO;
        template.content = "{{name}} {{fullPrice}} {{bankName}} {{accNum}}";
        const first = await describeClientMessageEffect(input);
        expect(first.status).toBe("effect");
        expect(await describeClientMessageEffect({ ...input, client: changed })).not.toEqual(first);
        if (first.status === "effect") expect(agentAutomationEffectDigest([first.effect])).toMatch(/^[a-f0-9]{64}$/);
    });

    it("requires known sender authority and leaves inactive rules without a send effect", async () => {
        const { input, templates } = setup();
        for (const changed of [{ ...policy, senderApproved: false }, { ...policy, senderIdentityDigest: null }]) {
            expect(await describeClientMessageEffect({ ...input, policy: changed })).toEqual({ status: "unavailable", reason: "sender-unavailable" });
        }
        expect(await describeClientMessageEffect({ ...input, policy: { ...policy, dispatchEnabled: false } })).toEqual({ status: "none" });
        input.rule.isActive = false;
        expect(await describeClientMessageEffect(input)).toEqual({ status: "none" });
        expect(templates.getByKeyForBranch).not.toHaveBeenCalled();
    });

    it("refuses unknown templates, dynamic required content and lookup failures without invoking enrichment", async () => {
        const { input, template, templates, enrichers } = setup();
        Object.assign(template, { requiredVariables: [{ key: "opaqueFutureLink", required: true }] });
        expect(await describeClientMessageEffect(input)).toEqual({ status: "unavailable", reason: "unsupported-content" });
        templates.getByKeyForBranch.mockRejectedValue(new Error("unavailable"));
        expect(await describeClientMessageEffect(input)).toEqual({ status: "unavailable", reason: "unsupported-content" });
        input.rule.templateKey = MessageTriggerTemplateKey.SERVICE_RECORD_LINK;
        expect(await describeClientMessageEffect(input)).toEqual({ status: "unavailable", reason: "source-unavailable" });
        expect(enrichers.enrich).not.toHaveBeenCalled();
    });

    it("does not invent a job when optional dates are absent or a one-shot message was already sent", async () => {
        const { input, templates } = setup();
        input.rule.eventType = MessageTriggerEventType.SERVICE_END;
        input.rule.offsetType = MessageTriggerOffsetType.AFTER_DAYS;
        input.rule.templateKey = MessageTriggerTemplateKey.SERVICE_END_NOTICE;
        expect(await describeClientMessageEffect({ ...input, client: { ...client, endDate: null } })).toEqual({ status: "none" });
        expect(await describeClientMessageEffect({ ...input, client: { ...client, serviceEndNoticeSentAt: now } })).toEqual({ status: "none" });
        expect(templates.getByKeyForBranch).not.toHaveBeenCalled();
    });
});
