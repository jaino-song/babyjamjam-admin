import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";

function job(): MessageTriggerJobEntity {
    return MessageTriggerJobEntity.create({
        ruleId: "rule", scheduledFor: new Date(), recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER, dedupeKey: "job",
        payload: { memberId: "client:1", recipientName: "test", recipientPhone: "01000000000", templateVariables: {} },
    });
}

describe("MessageTriggerJobEntity terminal transitions", () => {
    for (const status of ["sent", "canceled"] as const) {
        it.each([
            ["processing", (entity: MessageTriggerJobEntity) => entity.markProcessing("new-token")],
            ["dispatching", (entity: MessageTriggerJobEntity) => entity.markDispatchAuthorized()],
            ["defer", (entity: MessageTriggerJobEntity) => entity.defer("transient", "later")],
            ["sent", (entity: MessageTriggerJobEntity) => entity.markSent()],
            ["failed", (entity: MessageTriggerJobEntity) => entity.markFailed("failure")],
            ["cancel", (entity: MessageTriggerJobEntity) => entity.cancel("cancel")],
            ["needs_setup", (entity: MessageTriggerJobEntity) => entity.markNeedsSetup("missing")],
        ])(`preserves all fields of ${status} when asked to transition to %s`, (_name, transition) => {
            const entity = job();
            if (status === "sent") entity.markSent();
            else entity.cancel("original");
            const before = { ...entity };
            transition(entity);
            expect(entity).toEqual(before);
        });
    }

    it("allows a late provider success to resolve a failed/uncertain attempt with its retained token", () => {
        const entity = job();
        entity.markProcessing("claim");
        entity.markDispatchAuthorized();
        entity.markFailed("uncertain");
        entity.markSent();
        expect(entity.status).toBe("sent");
        expect(entity.claimToken).toBe("claim");
    });
});
