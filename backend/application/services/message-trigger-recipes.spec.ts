import { MessageTriggerEventType as Event, MessageTriggerOffsetType as Offset, MessageTriggerRecipientType as Recipient, MessageTriggerTemplateKey as Template } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { buildClientMessageRecipe, buildEmployeeAssignmentMessageRecipe, type ClientTriggerSource, type EmployeeAssignmentScheduleSource } from "./message-trigger-recipes";

const now = new Date("2026-09-17T03:04:05.000Z");
function rule(template = Template.SERVICE_INFO, recipient = Recipient.CLIENT) {
    return MessageTriggerRuleEntity.reconstitute("rule-1", "branch-1", "합성 규칙", true,
        Event.SERVICE_START, Offset.BEFORE_DAYS, 7, recipient, template, now, now);
}
const client: ClientTriggerSource = {
    id: 11, name: "합성 고객", phone: "01000000011", type: null,
    startDate: new Date("2026-09-24T23:00:00.000Z"), endDate: null,
    serviceEndNoticeSentAt: null, createdAt: now,
};
const schedule: EmployeeAssignmentScheduleSource = {
    id: 22, branchId: "branch-1", clientId: 11, workAddress: "합성 주소",
    startDate: new Date("2026-09-20T00:00:00.000Z"), endDate: new Date("2026-09-30T00:00:00.000Z"),
    replaced: false, terminatedAt: null, primaryEmployeeId: 31, secondaryEmployeeId: 32,
    client: { id: 11, name: "합성 고객" },
    primaryEmployee: { id: 31, name: "합성 담당1", phone: "01000000031" },
    secondaryEmployee: { id: 32, name: "합성 담당2", phone: "01000000032" },
};

describe("shared message recipes for preview and materialization", () => {
    it("uses the existing Korea calendar offset and carries only relevant client variables", () => {
        const source = rule();
        source.sendTime = "09:30";
        const recipe = buildClientMessageRecipe(source, client, now)!;
        expect(recipe.scheduledFor.toISOString()).toBe("2026-09-18T00:30:00.000Z");
        expect(recipe.dedupeKey).toBe("rule-1:client:11:CLIENT:2026-09-18T00:30:00.000Z");
        expect(recipe.payload.templateVariables).toEqual({ name: client.name, clientName: client.name, phone: client.phone });
        expect(recipe).not.toHaveProperty("id");
        expect(recipe).not.toHaveProperty("status");
    });

    it("uses the supplied planning clock for immediate recipes", () => {
        const source = rule(Template.CLIENT_GREETING);
        source.eventType = Event.CLIENT_CREATED;
        source.offsetType = Offset.IMMEDIATE;
        expect(buildClientMessageRecipe(source, client, now)!.scheduledFor).toEqual(now);
        expect(buildClientMessageRecipe(source, { ...client, createdAt: null }, now)).toBeNull();
    });

    it("preserves missing-input and already-sent suppression", () => {
        expect(buildClientMessageRecipe(rule(), { ...client, phone: null }, now)).toBeNull();
        expect(buildClientMessageRecipe(rule(), { ...client, startDate: null }, now)).toBeNull();
        expect(buildClientMessageRecipe(rule(Template.SERVICE_END_NOTICE), { ...client, serviceEndNoticeSentAt: now }, now)).toBeNull();
    });

    it("keeps primary and secondary assignment recipients and source fingerprints separate", () => {
        const primary = buildEmployeeAssignmentMessageRecipe(rule(Template.EMPLOYEE_ASSIGNED, Recipient.PRIMARY_EMPLOYEE), schedule, now)!;
        const secondary = buildEmployeeAssignmentMessageRecipe(rule(Template.EMPLOYEE_ASSIGNED, Recipient.SECONDARY_EMPLOYEE), schedule, now)!;
        expect(primary.recipientPhone).toBe("01000000031");
        expect(secondary.recipientPhone).toBe("01000000032");
        expect(primary.dedupeKey).toBe("rule-1:schedule:22:employee:31:PRIMARY_EMPLOYEE");
        expect(secondary.dedupeKey).toBe("rule-1:schedule:22:employee:32:SECONDARY_EMPLOYEE");
        expect(primary.scheduledFor).toEqual(now);
        expect(primary.payload.employeeScheduleFingerprint).not.toBe(secondary.payload.employeeScheduleFingerprint);
        const changed = buildEmployeeAssignmentMessageRecipe(rule(Template.EMPLOYEE_ASSIGNED, Recipient.PRIMARY_EMPLOYEE),
            { ...schedule, client: { ...schedule.client, name: "정정 고객" } }, now)!;
        expect(changed.payload.employeeScheduleFingerprint).not.toBe(primary.payload.employeeScheduleFingerprint);
        expect(buildEmployeeAssignmentMessageRecipe(rule(Template.EMPLOYEE_ASSIGNED, Recipient.SECONDARY_EMPLOYEE),
            { ...schedule, secondaryEmployee: null }, now)).toBeNull();
    });
});
