import { randomUUID } from "node:crypto";
import type { AgentTask } from "@babyjamjam/shared";
import { createEmptyAgentTaskDraft, toAgentTaskContract } from "domain/entities/agent-task.entity";
import { ConversationTaskOrchestratorService, explicitConversationTaskCommand } from "./conversation-task-orchestrator.service";

const principal = { userId: randomUUID(), branchId: randomUUID(), globalRole: "admin", branchRole: "manager" };
const sessionId = randomUUID();
function task(state: AgentTask["state"] = "collecting"): AgentTask {
    return toAgentTaskContract({ taskId: randomUUID(), sessionId, userId: principal.userId, branchId: principal.branchId,
        capabilityId: "clients.create", schemaVersion: 1, revision: 2, status: state, activeSlot: 1,
        draft: createEmptyAgentTaskDraft(randomUUID()), targetRef: null, targetVersion: null, activeActionId: null,
        lastAcceptedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), terminalAt: null, purgedAt: null,
        createdAt: new Date(), updatedAt: new Date() });
}
function setup(current = task()) {
    const tasks = {
        replayConversationIntake: jest.fn().mockResolvedValue(null), listForConversation: jest.fn().mockResolvedValue([current]),
        get: jest.fn().mockResolvedValue(current), patchFromConversation: jest.fn().mockResolvedValue({ snapshot: current }),
        createFromConversation: jest.fn().mockResolvedValue({ snapshot: current }),
        recordConversationIntake: jest.fn().mockResolvedValue({ snapshot: current }),
        commandFromConversation: jest.fn().mockImplementation(async (_principal, _taskId, input) => ({ snapshot: current, commandAccepted: input.command })),
    };
    const service = new ConversationTaskOrchestratorService(tasks as never, { assertCanCreate: async () => ({}) } as never);
    const turn = (text: string, id = randomUUID()) => service.handleUserTurn({ principal, sessionId,
        message: { id, role: "user", parts: [{ type: "text", text }] }, capabilityId: "clients.create" });
    return { tasks, service, turn, current };
}

describe("explicit conversation task commands", () => {
    it.each(["검토안 준비해 줘", "검토안 준비해주세요", "검토안 만들어 줘!", "  검토안   만들어주세요.  "])("accepts bounded review text: %s", (text) => {
        expect(explicitConversationTaskCommand(text)).toBe("prepare-review");
    });
    it.each(["현재 작업 취소해 줘", "이 작업 취소해 주세요"])("accepts explicit task cancellation: %s", (text) => {
        expect(explicitConversationTaskCommand(text)).toBe("cancel");
    });
    it.each(["검토안 준비해 줘?", "검토안 준비 가능한가요", '"검토안 준비해 줘"', "검토안 준비하지 마", "이름: 합성, 검토안 준비해 줘", "예", "승인", "취소", "작업을 취소하면 어떻게 돼?", "검토안 준비해 줘 그리고 실행해"])("does not grant command authority for: %s", (text) => {
        expect(explicitConversationTaskCommand(text)).toBeUndefined();
    });
    it("uses the pending review for explicit correction instead of creating another task", async () => {
        const current = task("awaiting_approval"); current.action = { actionId: randomUUID(), expectedRevision: "review" };
        const { tasks, turn } = setup(current);
        await turn("이름: 합성 정정");
        expect(tasks.patchFromConversation).toHaveBeenCalledWith(principal, current.taskId,
            expect.objectContaining({ expectedRevision: 2 }), "user", expect.any(String));
        expect(tasks.createFromConversation).not.toHaveBeenCalled();
    });
    it.each(["executing", "reconciling", "awaiting_approval"] as const)("refuses busy/malformed %s without creation", async (state) => {
        const { tasks, turn } = setup(task(state));
        const result = await turn("이름: 합성 정정");
        expect(result.mutationBlocked).toBe(true); expect(result.mutated).toBe(false);
        expect(tasks.patchFromConversation).not.toHaveBeenCalled(); expect(tasks.createFromConversation).not.toHaveBeenCalled();
    });
    it("uses only the committed operation marker when a command races with a historical intake", async () => {
        const { tasks, turn, current } = setup();
        tasks.commandFromConversation.mockResolvedValueOnce({ snapshot: current });
        const result = await turn("검토안 준비해 줘");
        expect(tasks.commandFromConversation).toHaveBeenCalledTimes(1);
        expect(result.commandAccepted).toBeUndefined(); expect(result.mutated).toBe(false); expect(result.mutationBlocked).toBe(true);
    });
    it.each([undefined, "prepare-review", "cancel"] as const)("reconstructs replay marker %s solely from receipt", async (marker) => {
        const { tasks, turn, current } = setup();
        tasks.replayConversationIntake.mockResolvedValueOnce({ snapshot: current, ...(marker ? { commandAccepted: marker } : {}) });
        const result = await turn("검토안 준비해 줘");
        expect(result.commandAccepted).toBe(marker); expect(result.replayed).toBe(true);
        expect(tasks.commandFromConversation).not.toHaveBeenCalled(); expect(tasks.listForConversation).not.toHaveBeenCalled();
    });
    it("propagates an event payload conflict before command parsing or task dispatch", async () => {
        const { tasks, turn } = setup();
        tasks.replayConversationIntake.mockRejectedValueOnce(new Error("event_payload"));
        await expect(turn("검토안 준비해 줘")).rejects.toThrow("event_payload");
        expect(tasks.listForConversation).not.toHaveBeenCalled(); expect(tasks.commandFromConversation).not.toHaveBeenCalled();
    });
    it.each(["session", "capability", "busy"])("refuses model task scope mismatch: %s", async (kind) => {
        const current = task();
        if (kind === "session") current.sessionId = randomUUID();
        if (kind === "capability") current.capabilityId = "clients.update";
        if (kind === "busy") current.state = "executing";
        const { tasks, service } = setup(current);
        await expect(service.applyModelMutation({ principal, sessionId, taskId: current.taskId, expectedRevision: current.revision,
            capabilityId: "clients.create", operations: [{ op: "set", field: "voucherClient", value: false }], intakeEventId: randomUUID() }))
            .rejects.toMatchObject({ status: 409 });
        expect(tasks.patchFromConversation).not.toHaveBeenCalled(); expect(tasks.createFromConversation).not.toHaveBeenCalled();
    });
});
