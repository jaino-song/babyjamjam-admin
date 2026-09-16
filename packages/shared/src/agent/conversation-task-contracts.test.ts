import {
    AgentAutomationConsentInputSchema,
    AgentAutomationConsentSchema,
    AgentEntitySelectPartSchema,
    AgentTaskCommandRequestSchema,
    AgentTaskCreateRequestSchema,
    AgentTaskPatchPartSchema,
    AgentTaskPatchRequestSchema,
    AgentTaskSchema,
    AgentTaskSnapshotEnvelopeSchema,
    AgentTaskStateSchema,
    ClientInputOperationSchema,
    applyClientInputOperations,
    createAgentTaskDefaults,
    evaluateClientReadiness,
    normalizeClientPhone,
    projectTaskForSafeChat,
    acceptAgentTaskSnapshot,
    type AgentTask,
    type AgentTaskClientSnapshotState,
} from "./index";

const TIMES = {
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:01.000Z",
};

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return AgentTaskSchema.parse({
        schemaVersion: 1,
        taskId: "task-1",
        sessionId: "session-1",
        revision: 2,
        state: "collecting",
        confirmed: {
            name: "홍길동",
            phone: "01012345678",
            address: "서울시 보호 주소",
            birthday: "900101",
        },
        tentative: { dueDate: "2026-12-01" },
        provenance: {
            confirmed: {
                name: { source: "user" },
                phone: { source: "user", valueRef: "protected-phone-ref" },
                address: { source: "user", valueRef: "protected-address-ref" },
                birthday: { source: "user", valueRef: "protected-birth-ref" },
            },
            tentative: { dueDate: { source: "model" } },
        },
        issues: [],
        constraints: { noSend: false, automationChoice: "unanswered" },
        choiceSets: [{
            choiceSetRef: "choice-set-1",
            options: [{ optionId: "option-1", label: "서비스 대상 1" }],
        }],
        orderedChoiceRefs: ["choice-set-1"],
        target: null,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: TIMES,
        currentSnapshotRef: "snapshot-2",
        ...overrides,
    });
}

describe("conversational task contracts", () => {
    it("keeps confirmed, tentative, and explicit clear separate", () => {
        const state = applyClientInputOperations([
            { op: "set", field: "name", value: " 홍길동 " },
            { op: "set", field: "phone", value: "010-1234-5678" },
            { op: "mark-tentative", field: "dueDate", value: "2026-12-01" },
            { op: "clear", field: "address" },
        ], {
            confirmed: { address: "삭제될 주소" },
            tentative: {},
            automationChoice: "unanswered",
            noSend: false,
        });

        expect(state.confirmed).toEqual({ name: "홍길동", phone: "01012345678" });
        expect(state.tentative).toEqual({ dueDate: "2026-12-01" });
        expect(ClientInputOperationSchema.safeParse({ op: "clear", field: "name" }).success).toBe(false);
        expect(ClientInputOperationSchema.safeParse({ op: "set", field: "address", value: null }).success).toBe(false);
    });

    it("keeps create defaults out of an update and rejects authority fields", () => {
        expect(createAgentTaskDefaults()).toEqual({ voucherClient: false, serviceStatus: "pre_booking" });

        expect(AgentTaskCreateRequestSchema.safeParse({
            clientEventId: "event-1",
            operations: [],
            userId: "user-assertion",
        }).success).toBe(false);
        expect(AgentTaskPatchRequestSchema.safeParse({
            clientEventId: "event-2",
            expectedRevision: 1,
            operations: [],
        }).success).toBe(false);
        expect(AgentTaskPatchRequestSchema.safeParse({
            clientEventId: "event-2",
            expectedRevision: 1,
            targetVersion: "client-asserted",
            operations: [{ op: "set", field: "name", value: "홍길동" }],
        }).success).toBe(false);
        expect(AgentTaskCommandRequestSchema.safeParse({
            clientEventId: "event-3",
            expectedRevision: 1,
            command: "approve",
        }).success).toBe(false);
    });

    it("requires an actual duplicate-check result for readiness", () => {
        expect(normalizeClientPhone("010-1234-5678")).toBe("01012345678");
        expect(normalizeClientPhone("010/1234/5678")).toBeNull();
        expect(evaluateClientReadiness({ name: "홍길동", phone: "010-1234-5678" }, undefined).ready).toBe(false);
        expect(evaluateClientReadiness(
            { name: "홍길동", phone: "010-1234-5678" },
            { status: "clear", checkedPhone: "01000000000" },
        ).ready).toBe(false);
        expect(evaluateClientReadiness(
            { name: "홍길동", phone: "010-1234-5678" },
            { status: "clear", checkedPhone: "01012345678" },
        ).ready).toBe(true);
    });

    it("keeps consent unanswered until the server binds a yes effect", () => {
        expect(AgentAutomationConsentInputSchema.safeParse({
            choice: "yes",
            binding: { effectDigest: "client-made-digest" },
        }).success).toBe(false);
        expect(AgentAutomationConsentSchema.safeParse({ choice: "yes", binding: null }).success).toBe(false);
        expect(AgentAutomationConsentSchema.safeParse({
            choice: "yes",
            binding: {
                recipientRef: "recipient-1",
                effectDigest: "effect-digest-1",
                templateRef: "template-1",
                policyDigest: "policy-digest-1",
                consentEventId: "consent-event-1",
            },
        }).success).toBe(true);
    });

    it("projects protected values as statuses and opaque references only", () => {
        const task = makeTask();
        const safe = projectTaskForSafeChat(task);
        const encoded = JSON.stringify(safe);

        expect(encoded).not.toContain("01012345678");
        expect(encoded).not.toContain("서울시 보호 주소");
        expect(encoded).not.toContain("900101");
        expect(safe.fieldStatus).toEqual(expect.arrayContaining([
            { field: "phone", status: "confirmed", valueRef: "protected-phone-ref" },
            { field: "address", status: "confirmed", valueRef: "protected-address-ref" },
            { field: "birthday", status: "confirmed", valueRef: "protected-birth-ref" },
        ]));
    });

    it("accepts only monotonic identity and revision snapshots", () => {
        const current: AgentTaskClientSnapshotState = {
            identityEpoch: 2,
            task: makeTask({ revision: 2 }),
            acknowledgedEventIds: [],
            pendingEventIds: ["unsent-event"],
        };

        const lower = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ revision: 1 }),
        }));
        expect(lower.accepted).toBe(false);
        expect(lower.reason).toBe("lower-revision");

        const staleIdentity = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 1,
            task: makeTask({ revision: 3 }),
        }));
        expect(staleIdentity.accepted).toBe(false);
        expect(staleIdentity.reason).toBe("stale-identity");

        const conflict = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ revision: 3 }),
            conflict: { status: 409, latestRevision: 3 },
        }));
        expect(conflict.reason).toBe("conflict-latest");
        expect(conflict.autoMerged).toBe(false);
        expect(conflict.state.pendingEventIds).toEqual(["unsent-event"]);
        expect(conflict.needsReconciliation).toBe(true);
    });

    it("keeps new data parts structured and free of raw patch values", () => {
        expect(AgentEntitySelectPartSchema.safeParse({
            taskId: "task-1",
            choiceSetRef: "choice-set-1",
            prompt: "대상을 선택하세요",
            options: [{ optionId: "option-1", label: "대상 1" }],
        }).success).toBe(true);
        expect(AgentTaskPatchPartSchema.safeParse({
            taskId: "task-1",
            eventId: "event-1",
            operations: [{ op: "set", field: "phone", valueRef: "protected-phone-ref" }],
        }).success).toBe(true);
        expect(AgentTaskPatchPartSchema.safeParse({
            taskId: "task-1",
            eventId: "event-1",
            operations: [{ op: "set", field: "phone", value: "01012345678" }],
        }).success).toBe(false);
        expect(AgentTaskStateSchema.safeParse("review_ready").success).toBe(true);
    });
});
