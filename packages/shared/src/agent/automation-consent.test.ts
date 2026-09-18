import { AgentAutomationQuestionSchema, AgentTaskSchema } from "./task-types";
import { projectTaskForSafeChat } from "./task-projection";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const question = () => ({
    questionRef: uuid(1), availability: "available" as const,
    effectDigest: "a".repeat(64), policyDigest: "b".repeat(64),
    recipientSetRef: uuid(2), templateSetRef: uuid(3),
    effects: [{ effectRef: uuid(4), recipientRef: uuid(5), kind: "client-rule" as const,
        recipientType: "client" as const, change: "create" as const, templateKey: "CLIENT_GREETING" as const }],
});

describe("automation question authority boundary", () => {
    it("accepts a server question, but rejects caller authority and body/recipient preimages", () => {
        expect(AgentAutomationQuestionSchema.parse(question()).effects).toHaveLength(1);
        for (const extra of [{ approved: true }, { recipientPhone: "01012345678" }, { messageBody: "secret" }]) {
            expect(AgentAutomationQuestionSchema.safeParse({ ...question(), ...extra }).success).toBe(false);
        }
    });

    it("requires finite, internally consistent availability and unique effect references", () => {
        expect(AgentAutomationQuestionSchema.safeParse({ ...question(), effects: [] }).success).toBe(false);
        expect(AgentAutomationQuestionSchema.safeParse({ ...question(), effects: [question().effects[0], question().effects[0]] }).success).toBe(false);
        expect(AgentAutomationQuestionSchema.safeParse({ ...question(), availability: "unavailable" }).success).toBe(false);
        expect(AgentAutomationQuestionSchema.safeParse({ ...question(), availability: "unavailable", reason: "missing-default-rules" }).success).toBe(true);
        expect(AgentAutomationQuestionSchema.safeParse({ ...question(), availability: "none", effects: [] }).success).toBe(true);
    });

    it("keeps question identities and counts in chat, without copying delivery descriptors or digests", () => {
        const task = AgentTaskSchema.parse({
            schemaVersion: 1, taskId: uuid(10), sessionId: uuid(11), kind: "clients.create", capabilityId: "clients.create",
            revision: 3, state: "collecting", confirmed: { name: "SYN_PRIVATE_NAME", phone: "01012345678" }, tentative: {},
            provenance: { confirmed: {}, tentative: {} }, issues: [], constraints: { noSend: false },
            choiceSets: [], orderedChoiceRefs: [], target: null, consent: { choice: "unanswered", binding: null },
            automation: question(), action: null, currentSnapshotRef: uuid(12),
            times: { createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z" },
        });
        const safe = projectTaskForSafeChat(task);
        expect(safe.automation).toEqual({ questionRef: uuid(1), availability: "available", effectCount: 1, recipientCount: 1 });
        const text = JSON.stringify(safe);
        for (const value of ["SYN_PRIVATE_NAME", "01012345678", "CLIENT_GREETING", "a".repeat(64), uuid(5)]) {
            expect(text).not.toContain(value);
        }
        const { automation: _oldAbsent, ...old } = task;
        expect(AgentTaskSchema.safeParse(old).success).toBe(true);
        expect(projectTaskForSafeChat(AgentTaskSchema.parse(old)).automation).toBeUndefined();
    });
});
