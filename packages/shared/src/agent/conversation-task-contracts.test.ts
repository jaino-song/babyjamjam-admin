import {
    AgentAutomationConsentInputSchema,
    AgentAutomationConsentSchema,
    AgentEntitySelectPartSchema,
    AgentTaskCommandRequestSchema,
    AgentTaskCreateRequestSchema,
    AgentTaskIssueCodeSchema,
    AgentTaskPatchPartSchema,
    AgentTaskPatchRequestSchema,
    AgentTaskRestoreMetadataSchema,
    AgentTaskSchema,
    AgentTaskSafeSnapshotSchema,
    AgentTaskSnapshotEnvelopeSchema,
    AgentTaskStateSchema,
    AgentTaskTargetVersionSchema,
    ClientInputOperationSchema,
    ClientClearedFieldsSchema,
    ClientWriteFieldsSchema,
    ClientTentativeValuesSchema,
    applyClientInputOperations,
    captureAgentTaskSnapshotRequest,
    createAgentTaskSnapshotState,
    createAgentTaskDefaults,
    evaluateClientReadiness,
    normalizeClientPhone,
    projectTaskForSafeChat,
    acceptAgentTaskSnapshot,
    resetAgentTaskSnapshotState,
    type AgentTask,
    type AgentTaskClientSnapshotState,
} from "./index";

const IDS = {
    task: "11111111-1111-4111-8111-111111111111",
    session: "22222222-2222-4222-8222-222222222222",
    event1: "33333333-3333-4333-8333-333333333333",
    event2: "44444444-4444-4444-8444-444444444444",
    snapshot2: "55555555-5555-4555-8555-555555555555",
    snapshot3: "66666666-6666-4666-8666-666666666666",
    choiceSet: "77777777-7777-4777-8777-777777777777",
    option: "88888888-8888-4888-8888-888888888888",
    phoneRef: "99999999-9999-4999-8999-999999999999",
    addressRef: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    birthRef: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const HASH = "a".repeat(64);
const TIMES = { createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:01.000Z" };

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return AgentTaskSchema.parse({
        schemaVersion: 1,
        taskId: IDS.task,
        sessionId: IDS.session,
        kind: "clients.create",
        capabilityId: "clients.create",
        revision: 2,
        state: "collecting",
        confirmed: {
            name: "홍길동",
            phone: "01012345678",
            address: "서울시 보호 주소",
            birthday: "900101",
        },
        tentative: { dueDate: "연말쯤" },
        provenance: {
            confirmed: {
                name: { source: "user" },
                phone: { source: "user", valueRef: IDS.phoneRef },
                address: { source: "user", valueRef: IDS.addressRef },
                birthday: { source: "user", valueRef: IDS.birthRef },
            },
            tentative: { dueDate: { source: "model" } },
        },
        issues: [],
        constraints: { noSend: false },
        choiceSets: [{ choiceSetRef: IDS.choiceSet, options: [{ optionId: IDS.option, label: "서울시 보호 주소" }] }],
        orderedChoiceRefs: [IDS.choiceSet],
        target: null,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: TIMES,
        currentSnapshotRef: IDS.snapshot2,
        ...overrides,
    });
}

describe("conversational task contracts", () => {
    it("keeps confirmed, tentative, and explicit clear separate", () => {
        const state = applyClientInputOperations([
            { op: "set", field: "name", value: " 홍길동 " },
            { op: "set", field: "phone", value: "010-1234-5678" },
            { op: "mark-tentative", field: "dueDate", value: "연말쯤" },
            { op: "clear", field: "address" },
        ], { confirmed: { address: "삭제될 주소" }, tentative: {}, clearedFields: [], automationChoice: "unanswered", noSend: false });

        expect(state.confirmed).toEqual({ name: "홍길동", phone: "01012345678" });
        expect(state.tentative).toEqual({ dueDate: "연말쯤" });
        expect(state.clearedFields).toEqual(["address"]);
        expect(ClientInputOperationSchema.parse({ op: "set", field: "phone", value: "010-1234-5678" })).toEqual({
            op: "set", field: "phone", value: "01012345678",
        });
        expect(ClientInputOperationSchema.safeParse({ op: "clear", field: "name" }).success).toBe(false);
        expect(ClientInputOperationSchema.safeParse({ op: "clear", field: "phone" }).success).toBe(false);
        expect(ClientInputOperationSchema.safeParse({ op: "clear", field: "voucherClient" }).success).toBe(false);
        expect(ClientInputOperationSchema.safeParse({ op: "clear", field: "breastPump" }).success).toBe(false);
        expect(ClientInputOperationSchema.safeParse({ op: "set", field: "address", value: null }).success).toBe(false);
    });

    it("canonicalizes clear markers, preserves clear intent, and rejects contradictions", () => {
        expect(ClientClearedFieldsSchema.parse(["dueDate", "address", "dueDate"])).toEqual(["address", "dueDate"]);

        const cleared = applyClientInputOperations([
            { op: "clear", field: "address" },
            { op: "mark-tentative", field: "address", value: "나중에 확인" },
        ], {
            confirmed: { address: "삭제될 주소" },
            tentative: {},
            clearedFields: [],
            automationChoice: "unanswered",
            noSend: false,
        });
        expect(cleared.confirmed).toEqual({});
        expect(cleared.tentative).toEqual({ address: "나중에 확인" });
        expect(cleared.clearedFields).toEqual(["address"]);

        const restored = applyClientInputOperations([{ op: "set", field: "address", value: "새 주소" }], cleared);
        expect(restored.confirmed).toEqual({ address: "새 주소" });
        expect(restored.tentative).toEqual({});
        expect(restored.clearedFields).toEqual([]);
        const clearOnly = applyClientInputOperations([{ op: "clear", field: "address" }], {
            confirmed: { address: "삭제될 주소" },
            tentative: {},
            clearedFields: [],
            automationChoice: "unanswered",
            noSend: false,
        });
        expect(applyClientInputOperations([{ op: "clear", field: "address" }], clearOnly)).toEqual(clearOnly);
        expect(() => applyClientInputOperations([], {
            confirmed: { address: "충돌" },
            tentative: {},
            clearedFields: ["address"],
            automationChoice: "unanswered",
            noSend: false,
        })).toThrow("cleared field");
        expect(AgentTaskSchema.safeParse({ ...makeTask(), confirmed: { address: "충돌" }, clearedFields: ["address"] }).success).toBe(false);
    });

    it("supports ordered discard-change composition without touching automation controls", () => {
        const initial = {
            confirmed: { name: "기존 이름", startDate: "2026-03-01", address: "기존 주소" },
            tentative: { startDate: "2026-03-05" },
            clearedFields: [],
            automationChoice: "unanswered" as const,
            noSend: false,
        };
        const setThenDiscard = applyClientInputOperations([
            { op: "set", field: "startDate", value: "2026-03-05" },
            { op: "discard-change", field: "startDate" },
        ], initial);
        expect(setThenDiscard.confirmed.startDate).toBeUndefined();
        expect(setThenDiscard.tentative.startDate).toBeUndefined();

        const clearThenDiscard = applyClientInputOperations([
            { op: "clear", field: "address" },
            { op: "discard-change", field: "address" },
        ], initial);
        expect(clearThenDiscard.clearedFields).toEqual([]);
        expect(clearThenDiscard.confirmed.address).toBeUndefined();

        const discardThenSet = applyClientInputOperations([
            { op: "discard-change", field: "startDate" },
            { op: "set", field: "startDate", value: "2026-03-05" },
        ], initial);
        expect(discardThenSet.confirmed.startDate).toBe("2026-03-05");

        const discardThenClear = applyClientInputOperations([
            { op: "discard-change", field: "startDate" },
            { op: "clear", field: "startDate" },
        ], initial);
        expect(discardThenClear.confirmed.startDate).toBeUndefined();
        expect(discardThenClear.clearedFields).toEqual(["startDate"]);
        expect(ClientInputOperationSchema.safeParse({ op: "discard-change", field: "automationChoice" }).success).toBe(false);
        expect(ClientInputOperationSchema.safeParse({ op: "discard-change", field: "noSend" }).success).toBe(false);
        expect(ClientInputOperationSchema.safeParse({ op: "discard-change", field: "unknown" }).success).toBe(false);
    });

    it("keeps create defaults out of an update and rejects authority fields", () => {
        expect(createAgentTaskDefaults()).toEqual({ voucherClient: false, serviceStatus: "pre_booking" });
        expect(AgentTaskCreateRequestSchema.safeParse({
            sessionId: IDS.session,
            capabilityId: "clients.create",
            clientEventId: IDS.event1,
            operations: [],
            userId: "user-assertion",
        }).success).toBe(false);
        expect(AgentTaskCreateRequestSchema.safeParse({
            sessionId: IDS.session,
            capabilityId: "clients.create",
            clientEventId: IDS.event1,
            operations: [],
        }).success).toBe(true);
        expect(AgentTaskPatchRequestSchema.safeParse({ clientEventId: IDS.event2, expectedRevision: 1, operations: [] }).success).toBe(false);
        expect(AgentTaskPatchRequestSchema.safeParse({
            clientEventId: IDS.event2,
            expectedRevision: 1,
            targetVersion: "client-asserted",
            operations: [{ op: "set", field: "name", value: "홍길동" }],
        }).success).toBe(false);
        expect(AgentTaskCommandRequestSchema.safeParse({ clientEventId: IDS.event2, expectedRevision: 1, command: "approve" }).success).toBe(false);
        expect(AgentTaskPatchRequestSchema.safeParse({ clientEventId: IDS.event2, expectedRevision: "rev-1", operations: [{ op: "set", field: "name", value: "홍길동" }] }).success).toBe(false);
    });

    it("mirrors confirmed provider validators while allowing bounded tentative wishes", () => {
        expect(ClientWriteFieldsSchema.safeParse({ startDate: "2026-02-30" }).success).toBe(false);
        expect(ClientWriteFieldsSchema.safeParse({ fullPrice: "12.5" }).success).toBe(false);
        expect(ClientWriteFieldsSchema.safeParse({ birthday: "991332" }).success).toBe(false);
        expect(ClientWriteFieldsSchema.safeParse({ startDate: "2026-02-28", fullPrice: "1,000원", birthday: "900101" }).success).toBe(true);
        expect(ClientTentativeValuesSchema.safeParse({ dueDate: "연말쯤" }).success).toBe(true);
    });

    it("requires an actual duplicate-check result for readiness", () => {
        expect(normalizeClientPhone("010-1234-5678")).toBe("01012345678");
        expect(normalizeClientPhone("010/1234/5678")).toBeNull();
        expect(evaluateClientReadiness({ name: "홍길동", phone: "010-1234-5678" }, undefined).ready).toBe(false);
        expect(evaluateClientReadiness({ name: "홍길동", phone: "010-1234-5678" }, { status: "clear", checkedPhone: "01000000000" }).ready).toBe(false);
        expect(evaluateClientReadiness({ name: "홍길동", phone: "010-1234-5678" }, { status: "clear", checkedPhone: "01012345678" }).ready).toBe(true);
    });

    it("keeps consent unanswered until the server binds a yes effect", () => {
        expect(AgentAutomationConsentInputSchema.safeParse({ choice: "yes", binding: { effectDigest: HASH } }).success).toBe(false);
        expect(AgentAutomationConsentSchema.safeParse({ choice: "yes", binding: null }).success).toBe(false);
        expect(AgentAutomationConsentSchema.safeParse({
            choice: "yes",
            binding: { recipientRef: IDS.phoneRef, effectDigest: HASH, templateRef: IDS.choiceSet, policyDigest: HASH, consentEventId: IDS.event1 },
        }).success).toBe(true);
    });

    it("parses restore metadata with an additive legacy recovery default", () => {
        expect(AgentTaskRestoreMetadataSchema.parse({
            activeTaskId: IDS.task,
            pausedTaskIds: [IDS.event1],
            taskRestoreStatus: "available",
        })).toEqual({
            activeTaskId: IDS.task,
            pausedTaskIds: [IDS.event1],
            taskRestoreStatus: "available",
            recoveryTaskIds: [],
        });
        expect(AgentTaskRestoreMetadataSchema.parse({
            activeTaskId: null,
            pausedTaskIds: [],
            taskRestoreStatus: "session_expired",
            recoveryTaskIds: [IDS.task],
        }).recoveryTaskIds).toEqual([IDS.task]);
    });

    it("projects every protected value as statuses and precise refs only", () => {
        const task = makeTask();
        const safe = projectTaskForSafeChat(task);
        const encoded = JSON.stringify(safe);
        expect(encoded).not.toContain("01012345678");
        expect(encoded).not.toContain("서울시 보호 주소");
        expect(encoded).not.toContain("900101");
        expect(encoded).not.toContain("연말쯤");
        expect(encoded).not.toContain("task-1");
        expect(safe.fieldStatus).toEqual(expect.arrayContaining([
            { field: "phone", status: "confirmed", valueRef: IDS.phoneRef },
            { field: "address", status: "confirmed", valueRef: IDS.addressRef },
            { field: "birthday", status: "confirmed", valueRef: IDS.birthRef },
        ]));
        expect(safe.clearedFields).toEqual([]);
    });

    it("keeps clear-only markers distinct and drops stale deleted provenance refs", () => {
        const task = makeTask({
            confirmed: { name: "홍길동", phone: "01012345678" },
            tentative: {},
            clearedFields: ["address"],
            provenance: {
                confirmed: { address: { source: "user", valueRef: IDS.addressRef } },
                tentative: {},
            },
        });
        const safe = projectTaskForSafeChat(task);
        expect(safe.clearedFields).toEqual(["address"]);
        expect(safe.fieldStatus.find((entry) => entry.field === "address")).toEqual({ field: "address", status: "missing" });
        expect(JSON.stringify(safe)).not.toContain(IDS.addressRef);
    });

    it("accepts only monotonic identity and revision snapshots", () => {
        const current: AgentTaskClientSnapshotState = {
            identityEpoch: 2,
            requestGeneration: 0,
            task: makeTask({ revision: 2 }),
            acknowledgedEventIds: [],
            pendingEventIds: [IDS.event1, IDS.event2],
        };
        const currentRequest = captureAgentTaskSnapshotRequest(current);
        const lower = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({ identityEpoch: 2, task: makeTask({ revision: 1 }) }), currentRequest);
        expect(lower.accepted).toBe(false);
        expect(lower.reason).toBe("lower-revision");

        const staleIdentity = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({ identityEpoch: 1, task: makeTask({ revision: 3 }) }), currentRequest);
        expect(staleIdentity.accepted).toBe(false);
        expect(staleIdentity.reason).toBe("stale-identity");

        const sessionMismatch = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision: 3 }),
        }), currentRequest);
        expect(sessionMismatch.reason).toBe("different-session");

        const newerEpoch = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 3,
            task: makeTask({ taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", revision: 0 }),
            acknowledgedEventId: IDS.event2,
        }), currentRequest);
        expect(newerEpoch.reason).toBe("accepted-new-identity");
        expect(newerEpoch.state.pendingEventIds).toEqual([]);
        expect(newerEpoch.state.acknowledgedEventIds).toEqual([IDS.event2]);

        const ack = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ revision: 3 }),
            acknowledgedEventId: IDS.event1,
        }), currentRequest);
        expect(ack.state.pendingEventIds).toEqual([IDS.event2]);

        const conflict = acceptAgentTaskSnapshot(current, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ revision: 3 }),
            conflict: { status: 409, latestRevision: 3, latestSnapshotRef: IDS.snapshot3 },
        }), currentRequest);
        expect(conflict.reason).toBe("conflict-latest");
        expect(conflict.autoMerged).toBe(false);
        expect(conflict.state.pendingEventIds).toEqual([IDS.event1, IDS.event2]);
        expect(conflict.needsReconciliation).toBe(true);

        const reset = resetAgentTaskSnapshotState(current, 4);
        const resetRequest = captureAgentTaskSnapshotRequest(reset);
        const oldAfterReset = acceptAgentTaskSnapshot(reset, AgentTaskSnapshotEnvelopeSchema.parse({ identityEpoch: 3, task: makeTask({ revision: 99 }) }), currentRequest);
        expect(oldAfterReset.reason).toBe("stale-generation");
        const newAfterReset = acceptAgentTaskSnapshot(reset, AgentTaskSnapshotEnvelopeSchema.parse({ identityEpoch: 4, task: makeTask({ revision: 0 }) }), resetRequest);
        expect(newAfterReset.accepted).toBe(true);
        expect(newAfterReset.state.task?.revision).toBe(0);
        expect(newAfterReset.state.requestGeneration).toBe(reset.requestGeneration);

        const initial = createAgentTaskSnapshotState(2);
        const requestA = captureAgentTaskSnapshotRequest(initial);
        const resetSameIdentity = resetAgentTaskSnapshotState(initial);
        const requestB = captureAgentTaskSnapshotRequest(resetSameIdentity);
        const responseA = acceptAgentTaskSnapshot(resetSameIdentity, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", revision: 1 }),
        }), requestA);
        expect(responseA.accepted).toBe(false);
        expect(responseA.reason).toBe("stale-generation");
        expect(responseA.state.task).toBeNull();
        const responseB = acceptAgentTaskSnapshot(resetSameIdentity, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ taskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", revision: 1 }),
        }), requestB);
        expect(responseB.accepted).toBe(true);
        expect(responseB.state.task?.taskId).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

        const accountSwitch = resetAgentTaskSnapshotState(resetSameIdentity, 3);
        const accountRequest = captureAgentTaskSnapshotRequest(accountSwitch);
        expect(accountSwitch.requestGeneration).toBe(resetSameIdentity.requestGeneration + 1);
        expect(acceptAgentTaskSnapshot(accountSwitch, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 2,
            task: makeTask({ revision: 2 }),
        }), requestB).reason).toBe("stale-generation");
        expect(acceptAgentTaskSnapshot(accountSwitch, AgentTaskSnapshotEnvelopeSchema.parse({
            identityEpoch: 3,
            task: makeTask({ taskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff", revision: 0 }),
        }), accountRequest).reason).toBe("accepted");
        const repeatedReset = resetAgentTaskSnapshotState(accountSwitch, 3);
        expect(repeatedReset.requestGeneration).toBe(accountSwitch.requestGeneration + 1);
    });

    it("keeps provider target versions separate from task revisions", () => {
        expect(AgentTaskTargetVersionSchema.safeParse(HASH).success).toBe(true);
        expect(AgentTaskTargetVersionSchema.safeParse(2).success).toBe(false);
        expect(AgentTaskSchema.safeParse({ ...makeTask(), target: { targetRef: IDS.task, version: HASH } }).success).toBe(true);
        expect(AgentTaskSchema.safeParse({ ...makeTask(), target: { targetRef: IDS.task, version: 2 } }).success).toBe(false);
    });

    it("uses a finite issue-code vocabulary on authorized and safe paths", () => {
        const validIssue = { code: "task.required" as const, field: "phone" as const, severity: "error" as const, message: "전화번호가 필요합니다" };
        expect(AgentTaskIssueCodeSchema.safeParse(validIssue.code).success).toBe(true);
        const safe = projectTaskForSafeChat(makeTask({ issues: [validIssue] }));
        expect(safe.issues).toEqual([{ code: "task.required", field: "phone", severity: "error" }]);
        for (const code of ["task.01012345678", "task.900101", "task.unregistered"]) {
            expect(AgentTaskIssueCodeSchema.safeParse(code).success).toBe(false);
            expect(AgentTaskSchema.safeParse({ ...makeTask(), issues: [{ ...validIssue, code }] }).success).toBe(false);
            expect(AgentTaskSafeSnapshotSchema.safeParse({ ...safe, issues: [{ ...safe.issues[0], code }] }).success).toBe(false);
        }
    });

    it("keeps new data parts reference-only", () => {
        expect(AgentEntitySelectPartSchema.safeParse({ taskId: IDS.task, choiceSetRef: IDS.choiceSet, optionIds: [IDS.option] }).success).toBe(true);
        expect(AgentEntitySelectPartSchema.safeParse({ taskId: IDS.task, choiceSetRef: IDS.choiceSet, optionIds: [IDS.option], prompt: "01012345678" }).success).toBe(false);
        expect(AgentTaskPatchPartSchema.safeParse({ taskId: IDS.task, eventId: IDS.event1, acceptedRevision: 2, currentSnapshotRef: IDS.snapshot2 }).success).toBe(true);
        expect(AgentTaskPatchPartSchema.safeParse({ taskId: IDS.task, eventId: IDS.event1, acceptedRevision: 2, currentSnapshotRef: IDS.snapshot2, operations: [{ op: "set", field: "phone", value: "01012345678" }] }).success).toBe(false);
        const safe = projectTaskForSafeChat(makeTask());
        expect(AgentTaskSafeSnapshotSchema.safeParse({ ...safe, taskId: "01012345678" }).success).toBe(false);
        expect(AgentTaskSafeSnapshotSchema.safeParse({ ...safe, currentSnapshotRef: "서울시 보호 주소" }).success).toBe(false);
        expect(AgentTaskStateSchema.safeParse("review_ready").success).toBe(true);
    });
});
