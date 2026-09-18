import { act, renderHook, waitFor } from "@testing-library/react";
import { TextDecoder as NodeTextDecoder } from "node:util";
import { AgentTaskSchema, type AgentTask } from "@babyjamjam/shared/agent";

import { useAgentChat, useAgentShellEnabled } from "./useAgentChat";

const TASK_IDS = {
    task: "11111111-1111-4111-8111-111111111111",
    oldTask: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    newTask: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    session: "22222222-2222-4222-8222-222222222222",
    event: "33333333-3333-4333-8333-333333333333",
    oldSnapshot: "44444444-4444-4444-8444-444444444444",
    snapshot2: "55555555-5555-4555-8555-555555555555",
    snapshot3: "66666666-6666-4666-8666-666666666666",
    newSnapshot: "77777777-7777-4777-8777-777777777777",
};

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return AgentTaskSchema.parse({
        schemaVersion: 1,
        taskId: TASK_IDS.task,
        sessionId: TASK_IDS.session,
        kind: "clients.create",
        capabilityId: "clients.create",
        revision: 2,
        state: "collecting",
        confirmed: { name: "홍길동", phone: "01012345678" },
        tentative: {},
        provenance: {
            confirmed: { name: { source: "user" }, phone: { source: "user" } },
            tentative: {},
        },
        issues: [],
        constraints: { noSend: false },
        choiceSets: [],
        orderedChoiceRefs: [],
        target: null,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: { createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:01.000Z" },
        currentSnapshotRef: TASK_IDS.snapshot2,
        ...overrides,
    });
}

function jsonResponse(payload: unknown, options: { ok?: boolean; status?: number } = {}): Response {
    return {
        ok: options.ok ?? true,
        status: options.status ?? (options.ok === false ? 500 : 200),
        json: async () => payload,
    } as Response;
}

function taskSnapshotPart(taskId: string, snapshotRef: string, revision: number) {
    return {
        type: "data-task-snapshot",
        data: {
            taskId,
            snapshotRef,
            kind: "clients.create",
            capabilityId: "clients.create",
            revision,
            state: "collecting",
            fieldStatus: [],
        },
    };
}

describe("mobile useAgentChat", () => {
    beforeAll(() => {
        Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: NodeTextDecoder });
    });

    beforeEach(() => {
        window.sessionStorage.clear();
        jest.resetAllMocks();
    });

    it("restores messages for the persisted owned session", async () => {
        window.sessionStorage.setItem("agent_session_id", "session-a");
        const restoredMessages = [{ id: "message-a", role: "assistant", parts: [{ type: "text", text: "복원됨" }] }];
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            const payload = url.endsWith("/sessions/session-a")
                ? { id: "session-a", title: "대화", updatedAt: "2026-08-03", messages: restoredMessages }
                : [];

            return { ok: true, json: async () => payload } as Response;
        });

        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(result.current.messages).toEqual(restoredMessages));
    });

    it("restores only the server-authoritative active task when an older completed task has a higher revision", async () => {
        const oldTask = makeTask({ taskId: TASK_IDS.oldTask, revision: 99, state: "completed", currentSnapshotRef: TASK_IDS.oldSnapshot });
        const activeTask = makeTask({ taskId: TASK_IDS.newTask, revision: 1, currentSnapshotRef: TASK_IDS.newSnapshot });
        const fetchMock = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-active") && !init?.method) {
                return jsonResponse({
                    id: "session-active",
                    title: "활성 업무",
                    updatedAt: "2026-09-18",
                    activeTaskId: TASK_IDS.newTask,
                    pausedTaskIds: [],
                    taskRestoreStatus: "available",
                    recoveryTaskIds: [],
                    messages: [{
                        id: "restore-message",
                        role: "assistant",
                        parts: [
                            taskSnapshotPart(TASK_IDS.oldTask, TASK_IDS.oldSnapshot, 99),
                            taskSnapshotPart(TASK_IDS.newTask, TASK_IDS.newSnapshot, 1),
                        ],
                    }],
                });
            }
            if (url.endsWith(`/tasks/${TASK_IDS.oldTask}`)) return jsonResponse(oldTask);
            if (url.endsWith(`/tasks/${TASK_IDS.newTask}`)) return jsonResponse(activeTask);
            return jsonResponse([]);
        });
        global.fetch = fetchMock;

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.selectSession("session-active"); });
        await waitFor(() => expect(result.current.task?.taskId).toBe(TASK_IDS.newTask));

        expect(result.current.taskSnapshot?.taskId).toBe(TASK_IDS.newTask);
        expect(result.current.taskSnapshot?.revision).toBe(1);
        expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/tasks/${TASK_IDS.oldTask}`))).toBe(false);
    });

    it("resets task identity when the same session reports a newly active task", async () => {
        const oldTask = makeTask({ taskId: TASK_IDS.oldTask, revision: 8, currentSnapshotRef: TASK_IDS.oldSnapshot });
        const activeTask = makeTask({ taskId: TASK_IDS.newTask, revision: 1, currentSnapshotRef: TASK_IDS.newSnapshot });
        let restoreCount = 0;
        const fetchMock = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-transition") && !init?.method) {
                restoreCount += 1;
                const isNew = restoreCount > 1;
                return jsonResponse({
                    id: "session-transition",
                    title: "업무 전환",
                    updatedAt: "2026-09-18",
                    activeTaskId: isNew ? TASK_IDS.newTask : TASK_IDS.oldTask,
                    pausedTaskIds: isNew ? [TASK_IDS.oldTask] : [],
                    taskRestoreStatus: "available",
                    recoveryTaskIds: [],
                    messages: [{
                        id: isNew ? "restore-new" : "restore-old",
                        role: "assistant",
                        parts: isNew
                            ? [taskSnapshotPart(TASK_IDS.oldTask, TASK_IDS.oldSnapshot, 8), taskSnapshotPart(TASK_IDS.newTask, TASK_IDS.newSnapshot, 1)]
                            : [taskSnapshotPart(TASK_IDS.oldTask, TASK_IDS.oldSnapshot, 8)],
                    }],
                });
            }
            if (url.endsWith(`/tasks/${TASK_IDS.oldTask}`)) return jsonResponse(oldTask);
            if (url.endsWith(`/tasks/${TASK_IDS.newTask}`)) return jsonResponse(activeTask);
            return jsonResponse([]);
        });
        global.fetch = fetchMock;

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.selectSession("session-transition"); });
        await waitFor(() => expect(result.current.task?.taskId).toBe(TASK_IDS.oldTask));
        expect(result.current.taskSnapshot?.revision).toBe(8);

        await act(async () => { await result.current.selectSession("session-transition"); });
        await waitFor(() => expect(result.current.task?.taskId).toBe(TASK_IDS.newTask));

        expect(result.current.taskSnapshot?.taskId).toBe(TASK_IDS.newTask);
        expect(result.current.taskSnapshot?.revision).toBe(1);
    });

    it("resets identity when start-update returns the newly active task", async () => {
        const sourceTask = makeTask({ taskId: TASK_IDS.oldTask, revision: 8, currentSnapshotRef: TASK_IDS.oldSnapshot });
        const destinationTask = makeTask({ taskId: TASK_IDS.newTask, revision: 1, capabilityId: "clients.update", kind: "clients.update", currentSnapshotRef: TASK_IDS.newSnapshot });
        const fetchMock = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.oldTask}`) && !init?.method) return jsonResponse(sourceTask);
            if (url.endsWith(`/tasks/${TASK_IDS.oldTask}/commands`) && init?.method === "POST") {
                return jsonResponse({
                    receipt: {
                        taskId: TASK_IDS.newTask,
                        eventId: TASK_IDS.event,
                        eventHash: "a".repeat(64),
                        acceptedRevision: 1,
                        currentSnapshotRef: TASK_IDS.newSnapshot,
                    },
                    snapshot: destinationTask,
                });
            }
            return jsonResponse([]);
        });
        global.fetch = fetchMock;

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.oldTask); });
        expect(result.current.task?.taskId).toBe(TASK_IDS.oldTask);

        let mutation;
        await act(async () => {
            mutation = await result.current.commandTask(
                TASK_IDS.oldTask,
                { command: "start-update", targetRef: TASK_IDS.oldSnapshot, expectedTargetVersion: "b".repeat(64) },
                { expectedRevision: 8, clientEventId: TASK_IDS.event },
            );
        });

        expect(mutation).toEqual(expect.objectContaining({ status: "applied", task: destinationTask }));
        expect(result.current.task?.taskId).toBe(TASK_IDS.newTask);
        expect(result.current.taskSnapshot?.taskId).toBe(TASK_IDS.newTask);
        expect(result.current.taskSnapshot?.revision).toBe(1);
    });

    it("keeps the server-issued assistant message id from the UI message stream", async () => {
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                const payload = new Uint8Array(Buffer.from([
                    'data: {"type":"start","messageId":"assistant-server-id"}',
                    'data: {"type":"text-delta","delta":"응답"}',
                    "data: [DONE]",
                    "",
                ].join("\n")));
                let consumed = false;
                return {
                    ok: true,
                    headers: { get: (name: string) => name.toLowerCase() === "x-agent-session-id" ? "session-stream" : null },
                    body: { getReader: () => ({ read: async () => consumed ? { done: true } : (consumed = true, { done: false, value: payload }) }) },
                } as unknown as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await act(async () => { await result.current.sendMessage("질문"); });

        expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
            id: "assistant-server-id",
            role: "assistant",
            parts: [{ type: "text", text: "응답" }],
        }));
    });

    it("publishes one immutable assistant snapshot before the stream closes and updates that message", async () => {
        let releaseLaterChunk: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"start","messageId":"assistant-stream-id"}',
            'data: {"type":"text-delta","delta":"첫"}',
            'data: {"type":"data-action-result","data":{"status":"pending"}}',
            "",
        ].join("\n")));
        const laterChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"번째"}',
            "data: [DONE]",
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (!url.endsWith("/chat")) return { ok: true, json: async () => [] } as Response;
            let readCount = 0;
            return {
                ok: true,
                headers: { get: () => "session-stream" },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (readCount === 0) {
                                readCount += 1;
                                markFirstChunkRead?.();
                                return { done: false, value: firstChunk };
                            }
                            if (readCount === 1) {
                                readCount += 1;
                                await new Promise<void>((resolve) => { releaseLaterChunk = resolve; });
                                return { done: false, value: laterChunk };
                            }
                            return { done: true, value: new Uint8Array() };
                        },
                    }),
                },
            } as unknown as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages).toHaveLength(2));
        const firstAssistant = result.current.messages.at(-1);
        expect(firstAssistant).toEqual({
            id: "assistant-stream-id",
            role: "assistant",
            parts: [
                { type: "text", text: "첫" },
                { type: "data-action-result", data: { status: "pending" } },
            ],
        });

        releaseLaterChunk?.();
        await act(async () => { await sendPromise; });

        const finalAssistant = result.current.messages.at(-1);
        expect(finalAssistant).not.toBe(firstAssistant);
        expect(finalAssistant?.parts).not.toBe(firstAssistant?.parts);
        expect(finalAssistant?.id).toBe(firstAssistant?.id);
        expect(finalAssistant?.parts).toEqual([
            { type: "text", text: "첫번째" },
            { type: "data-action-result", data: { status: "pending" } },
        ]);
    });

    it("does not append later chunks from an aborted stream", async () => {
        let releaseLaterChunk: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"첫"}',
            "",
        ].join("\n")));
        const laterChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"늦은"}',
            "data: [DONE]",
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (!url.endsWith("/chat")) return { ok: true, json: async () => [] } as Response;
            let readCount = 0;
            return {
                ok: true,
                headers: { get: () => "session-aborted" },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (readCount === 0) {
                                readCount += 1;
                                markFirstChunkRead?.();
                                return { done: false, value: firstChunk };
                            }
                            if (readCount === 1) {
                                readCount += 1;
                                await new Promise<void>((resolve) => { releaseLaterChunk = resolve; });
                                return { done: false, value: laterChunk };
                            }
                            return { done: true, value: new Uint8Array() };
                        },
                    }),
                },
            } as unknown as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "첫" }]));

        act(() => { result.current.stop(); });
        releaseLaterChunk?.();
        await act(async () => { await sendPromise; });

        expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "첫" }]);
    });

    it("retires a stopped stream before delayed abort rejection and allows a later send", async () => {
        let chatCallCount = 0;
        let releaseAbortedRead: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"부분"}',
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (!url.endsWith("/chat")) return { ok: true, json: async () => [] } as Response;
            chatCallCount += 1;
            if (chatCallCount === 1) {
                let readCount = 0;
                return {
                    ok: true,
                    headers: { get: () => "session-stopped" },
                    body: {
                        getReader: () => ({
                            read: async () => {
                                if (readCount === 0) {
                                    readCount += 1;
                                    markFirstChunkRead?.();
                                    return { done: false, value: firstChunk };
                                }
                                if (readCount === 1) {
                                    readCount += 1;
                                    await new Promise<void>((resolve) => { releaseAbortedRead = resolve; });
                                    throw Object.assign(new Error("aborted"), { name: "AbortError" });
                                }
                                return { done: true, value: new Uint8Array() };
                            },
                        }),
                    },
                } as unknown as Response;
            }
            let consumed = false;
            return {
                ok: true,
                headers: { get: () => "session-next" },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (consumed) return { done: true, value: new Uint8Array() };
                            consumed = true;
                            return {
                                done: false,
                                value: new Uint8Array(Buffer.from([
                                    'data: {"type":"start","messageId":"assistant-next"}',
                                    'data: {"type":"text-delta","delta":"새 응답"}',
                                    "data: [DONE]",
                                    "",
                                ].join("\n"))),
                            };
                        },
                    }),
                },
            } as unknown as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let firstSend: Promise<void> | undefined;
        await act(async () => {
            firstSend = result.current.sendMessage("중단할 질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "부분" }]));
        expect(result.current.status).toBe("streaming");

        act(() => { result.current.stop(); });
        expect(result.current.status).toBe("ready");

        releaseAbortedRead?.();
        await act(async () => { await firstSend; });
        expect(result.current.status).toBe("ready");
        expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "부분" }]);

        await act(async () => { await result.current.sendMessage("다음 질문"); });
        expect(result.current.status).toBe("ready");
        expect(result.current.messages.at(-1)).toEqual({
            id: "assistant-next",
            role: "assistant",
            parts: [{ type: "text", text: "새 응답" }],
        });
    });

    it("does not append later chunks from a stale stream after switching sessions", async () => {
        let releaseLaterChunk: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"이전"}',
            "",
        ].join("\n")));
        const laterChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":" 응답"}',
            "data: [DONE]",
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                let readCount = 0;
                return {
                    ok: true,
                    headers: { get: () => "session-old" },
                    body: {
                        getReader: () => ({
                            read: async () => {
                                if (readCount === 0) {
                                    readCount += 1;
                                    markFirstChunkRead?.();
                                    return { done: false, value: firstChunk };
                                }
                                if (readCount === 1) {
                                    readCount += 1;
                                    await new Promise<void>((resolve) => { releaseLaterChunk = resolve; });
                                    return { done: false, value: laterChunk };
                                }
                                return { done: true, value: new Uint8Array() };
                            },
                        }),
                    },
                } as unknown as Response;
            }
            if (url.endsWith("/sessions/session-new")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-new", title: "새 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-new", role: "assistant", parts: [{ type: "text", text: "새 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "이전" }]));

        await act(async () => { await result.current.selectSession("session-new"); });
        releaseLaterChunk?.();
        await act(async () => { await sendPromise; });

        expect(result.current.messages).toEqual([
            { id: "message-new", role: "assistant", parts: [{ type: "text", text: "새 대화" }] },
        ]);
    });

    it("aborts and detaches the active stream before switching sessions", async () => {
        let releaseRead: (() => void) | undefined;
        let chatSignal: AbortSignal | undefined;
        const streamed = new Uint8Array(Buffer.from('data: {"type":"text-delta","delta":"이전 응답"}\n'));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                chatSignal = init?.signal as AbortSignal;
                let delivered = false;
                return {
                    ok: true,
                    headers: { get: () => "session-a" },
                    body: { getReader: () => ({
                        read: async () => {
                            if (delivered) return { done: true };
                            await new Promise<void>((resolve) => { releaseRead = resolve; });
                            delivered = true;
                            return { done: false, value: streamed };
                        },
                    }) },
                } as unknown as Response;
            }
            if (url.endsWith("/sessions/session-b")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-b", title: "다른 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("오래 걸리는 질문");
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.status).toBe("streaming"));

        await act(async () => { await result.current.selectSession("session-b"); });
        expect(chatSignal?.aborted).toBe(true);
        releaseRead?.();
        await act(async () => { await sendPromise; });

        expect(result.current.messages).toEqual([
            { id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] },
        ]);
    });

    it("aborts and detaches a form submission before switching sessions", async () => {
        let releaseBody: (() => void) | undefined;
        let formSignal: AbortSignal | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                formSignal = init?.signal as AbortSignal;
                return {
                    ok: true,
                    headers: { get: () => "session-a" },
                    text: async () => new Promise<string>((resolve) => {
                        releaseBody = () => resolve("done");
                    }),
                } as unknown as Response;
            }
            if (url.endsWith("/sessions/session-b")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-b", title: "다른 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let formPromise: Promise<void> | undefined;
        await act(async () => {
            formPromise = result.current.submitStructuredForm("clients.create-session-a", {
                name: "홍길동", phone: "01012345678",
            });
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.status).toBe("streaming"));

        await act(async () => { await result.current.selectSession("session-b"); });
        expect(formSignal?.aborted).toBe(true);
        releaseBody?.();
        await act(async () => { await formPromise; });

        expect(result.current.messages).toEqual([
            { id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] },
        ]);
    });

    it("ignores an older session response whose JSON finishes after a newer selection", async () => {
        let releaseSessionA: (() => void) | undefined;
        let markSessionAJsonStarted: (() => void) | undefined;
        const sessionAJsonStarted = new Promise<void>((resolve) => { markSessionAJsonStarted = resolve; });
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-a")) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionAJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionA = resolve; });
                        return {
                            id: "session-a", title: "느린 대화", updatedAt: "2026-08-03",
                            messages: [{ id: "message-a", role: "assistant", parts: [{ type: "text", text: "느린 대화" }] }],
                        };
                    },
                } as Response;
            }
            if (url.endsWith("/sessions/session-b")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-b", title: "최신 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "최신 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sessionAPromise: Promise<void> | undefined;
        await act(async () => {
            sessionAPromise = result.current.selectSession("session-a");
            await sessionAJsonStarted;
        });
        await act(async () => { await result.current.selectSession("session-b"); });
        releaseSessionA?.();
        await act(async () => { await sessionAPromise; });

        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-b");
        expect(result.current.messages).toEqual([
            { id: "message-b", role: "assistant", parts: [{ type: "text", text: "최신 대화" }] },
        ]);
    });

    it("ignores a pending selection after its target is deleted", async () => {
        let releaseSessionB: (() => void) | undefined;
        let markSessionBJsonStarted: (() => void) | undefined;
        const sessionBJsonStarted = new Promise<void>((resolve) => { markSessionBJsonStarted = resolve; });
        const sessionA = {
            id: "session-a", title: "현재 대화", updatedAt: "2026-08-03",
            messages: [{ id: "message-a", role: "assistant", parts: [{ type: "text", text: "현재 대화" }] }],
        };
        const sessionB = {
            id: "session-b", title: "삭제할 대화", updatedAt: "2026-08-04",
            messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "삭제할 대화" }] }],
        };
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-a") && !init?.method) {
                return { ok: true, json: async () => sessionA } as Response;
            }
            if (url.endsWith("/sessions/session-b") && init?.method === "DELETE") {
                return { ok: true } as Response;
            }
            if (url.endsWith("/sessions/session-b") && !init?.method) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionBJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionB = resolve; });
                        return sessionB;
                    },
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await act(async () => { await result.current.selectSession("session-a"); });
        let selectionB: Promise<void> | undefined;
        await act(async () => {
            selectionB = result.current.selectSession("session-b");
            await sessionBJsonStarted;
        });

        await act(async () => { await result.current.deleteSession("session-b"); });
        releaseSessionB?.();
        await act(async () => { await selectionB; });

        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-a");
        expect(result.current.messages).toEqual(sessionA.messages);
    });

    it("does not let a stale selection cleanup clear a newer pending selection", async () => {
        let releaseSessionA: (() => void) | undefined;
        let releaseSessionB: (() => void) | undefined;
        let markSessionAJsonStarted: (() => void) | undefined;
        let markSessionBJsonStarted: (() => void) | undefined;
        const sessionAJsonStarted = new Promise<void>((resolve) => { markSessionAJsonStarted = resolve; });
        const sessionBJsonStarted = new Promise<void>((resolve) => { markSessionBJsonStarted = resolve; });
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-a") && !init?.method) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionAJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionA = resolve; });
                        return { id: "session-a", title: "느린 대화", updatedAt: "2026-08-03", messages: [] };
                    },
                } as Response;
            }
            if (url.endsWith("/sessions/session-b") && init?.method === "DELETE") {
                return { ok: true } as Response;
            }
            if (url.endsWith("/sessions/session-b") && !init?.method) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionBJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionB = resolve; });
                        return {
                            id: "session-b", title: "최신 대화", updatedAt: "2026-08-04",
                            messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "최신 대화" }] }],
                        };
                    },
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let selectionA: Promise<void> | undefined;
        await act(async () => {
            selectionA = result.current.selectSession("session-a");
            await sessionAJsonStarted;
        });
        let selectionB: Promise<void> | undefined;
        await act(async () => {
            selectionB = result.current.selectSession("session-b");
            await sessionBJsonStarted;
        });

        releaseSessionA?.();
        await act(async () => { await selectionA; });
        await act(async () => { await result.current.deleteSession("session-b"); });
        releaseSessionB?.();
        await act(async () => { await selectionB; });

        expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();
        expect(result.current.messages).toEqual([]);
    });

    it.each([
        ["execution_failed", "failed", "nothing-happened", "승인 작업을 완료하지 못했습니다."],
        ["provider_reported_failure", "failed", "partial", "일부 단계가 실행되었을 수 있습니다."],
        ["provider_uncertain", "executing", "partial", "일부 단계가 실행되었을 수 있습니다."],
    ] as const)("preserves action error code for %s and classifies %s conservatively", async (errorCode, status, effectState, message) => {
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/approve")) return { ok: false } as Response;
            if (url.endsWith("/actions/action-outcome")) {
                return { ok: true, json: async () => ({ status, error: { code: errorCode } }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await act(async () => { await result.current.approveAction("action-outcome", "revision-a"); });

        expect(result.current.errorState).toEqual({ code: errorCode, message, effectState });
    });

    it("keeps a newer task snapshot when a stream and refresh return an older revision", async () => {
        let taskReadCount = 0;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.task}`)) {
                taskReadCount += 1;
                return jsonResponse(taskReadCount === 1
                    ? makeTask({ revision: 3, currentSnapshotRef: TASK_IDS.snapshot3 })
                    : makeTask({ revision: 2, currentSnapshotRef: TASK_IDS.snapshot2 }));
            }
            if (url.endsWith("/chat")) {
                let consumed = false;
                return {
                    ok: true,
                    headers: { get: () => TASK_IDS.session },
                    body: {
                        getReader: () => ({
                            read: async () => {
                                if (consumed) return { done: true, value: new Uint8Array() };
                                consumed = true;
                                return {
                                    done: false,
                                    value: new Uint8Array(Buffer.from([
                                        `data: {"type":"data-task-snapshot","data":{"taskId":"${TASK_IDS.task}","snapshotRef":"${TASK_IDS.snapshot2}","kind":"clients.create","capabilityId":"clients.create","revision":2,"state":"collecting","fieldStatus":[]}}`,
                                        "data: [DONE]",
                                        "",
                                    ].join("\n"))),
                                };
                            },
                        }),
                    },
                } as unknown as Response;
            }
            return jsonResponse([]);
        });

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.task); });
        expect(result.current.taskSnapshot?.revision).toBe(3);

        await act(async () => { await result.current.sendMessage("이전 초안 스트림"); });

        expect(result.current.taskSnapshot?.revision).toBe(3);
        expect(result.current.task?.revision).toBe(3);
    });

    it("releases a terminal task identity before accepting the next task in the same session", async () => {
        const terminalTask = makeTask({ taskId: TASK_IDS.oldTask, revision: 9, state: "completed", currentSnapshotRef: TASK_IDS.oldSnapshot });
        const nextTask = makeTask({ taskId: TASK_IDS.newTask, revision: 1, currentSnapshotRef: TASK_IDS.newSnapshot });
        const fetchMock = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.oldTask}`) && !init?.method) return jsonResponse(terminalTask);
            if (url.endsWith(`/tasks/${TASK_IDS.newTask}`) && !init?.method) return jsonResponse(nextTask);
            if (url.endsWith("/chat")) {
                let consumed = false;
                return {
                    ok: true,
                    headers: { get: () => TASK_IDS.session },
                    body: {
                        getReader: () => ({
                            read: async () => {
                                if (consumed) return { done: true, value: new Uint8Array() };
                                consumed = true;
                                return {
                                    done: false,
                                    value: new Uint8Array(Buffer.from([
                                        `data: ${JSON.stringify(taskSnapshotPart(TASK_IDS.newTask, TASK_IDS.newSnapshot, 1))}`,
                                        "data: [DONE]",
                                        "",
                                    ].join("\n"))),
                                };
                            },
                        }),
                    },
                } as unknown as Response;
            }
            return jsonResponse([]);
        });
        global.fetch = fetchMock;

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.oldTask); });
        expect(result.current.task?.state).toBe("completed");

        await act(async () => { await result.current.sendMessage("새 업무"); });

        expect(result.current.task?.taskId).toBe(TASK_IDS.newTask);
        expect(result.current.taskSnapshot?.taskId).toBe(TASK_IDS.newTask);
        expect(result.current.taskSnapshot?.revision).toBe(1);
        expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/tasks/${TASK_IDS.newTask}`))).toBe(true);
    });

    it("rejects a different task snapshot while the current task is still live", async () => {
        const liveTask = makeTask({ taskId: TASK_IDS.oldTask, revision: 8, currentSnapshotRef: TASK_IDS.oldSnapshot });
        const fetchMock = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.oldTask}`) && !init?.method) return jsonResponse(liveTask);
            if (url.endsWith("/chat")) {
                let consumed = false;
                return {
                    ok: true,
                    headers: { get: () => TASK_IDS.session },
                    body: {
                        getReader: () => ({
                            read: async () => {
                                if (consumed) return { done: true, value: new Uint8Array() };
                                consumed = true;
                                return {
                                    done: false,
                                    value: new Uint8Array(Buffer.from([
                                        `data: ${JSON.stringify(taskSnapshotPart(TASK_IDS.newTask, TASK_IDS.newSnapshot, 1))}`,
                                        "data: [DONE]",
                                        "",
                                    ].join("\n"))),
                                };
                            },
                        }),
                    },
                } as unknown as Response;
            }
            return jsonResponse([]);
        });
        global.fetch = fetchMock;

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.oldTask); });
        await act(async () => { await result.current.sendMessage("현재 업무 계속"); });

        expect(result.current.task?.taskId).toBe(TASK_IDS.oldTask);
        expect(result.current.taskSnapshot?.taskId).toBe(TASK_IDS.oldTask);
        expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/tasks/${TASK_IDS.newTask}`))).toBe(false);
    });

    it("sends the expected revision and event id, then exposes the latest task after a 409", async () => {
        const eventId = TASK_IDS.event;
        const latestTask = makeTask({ revision: 3, currentSnapshotRef: TASK_IDS.snapshot3 });
        const fetchMock = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && !init?.method) return jsonResponse(makeTask());
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && init?.method === "PATCH") {
                return jsonResponse({
                    code: "AGENT_TASK_CONFLICT",
                    message: "Task input conflict",
                    reason: "revision-mismatch",
                    snapshot: latestTask,
                }, { ok: false, status: 409 });
            }
            return jsonResponse([]);
        });
        global.fetch = fetchMock;

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.task); });
        let mutation;
        await act(async () => {
            mutation = await result.current.patchTask(
                TASK_IDS.task,
                [{ op: "set", field: "name", value: "새 이름" }],
                { clientEventId: eventId },
            );
        });

        expect(mutation).toEqual({ status: "conflict" });
        expect(result.current.taskSnapshot?.revision).toBe(3);
        expect(result.current.task?.revision).toBe(3);
        expect(result.current.taskNeedsReconciliation).toBe(true);
        expect(result.current.errorState).toEqual({
            code: "task_conflict",
            message: "초안이 다른 화면에서 변경되었습니다. 최신 내용을 확인해 주세요.",
            effectState: "nothing-happened",
        });

        const patchCall = fetchMock.mock.calls.find(([input, request]) => String(input).endsWith(`/tasks/${TASK_IDS.task}`) && request?.method === "PATCH");
        expect(patchCall).toBeDefined();
        const patchBody = JSON.parse(String(patchCall?.[1]?.body));
        expect(patchBody).toEqual({
            clientEventId: eventId,
            expectedRevision: 2,
            operations: [{ op: "set", field: "name", value: "새 이름" }],
        });
    });

    it("keeps one conflict notice until an authoritative refresh succeeds", async () => {
        const latestTask = makeTask({ revision: 3, currentSnapshotRef: TASK_IDS.snapshot3 });
        let taskReadCount = 0;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && !init?.method) {
                taskReadCount += 1;
                return jsonResponse(taskReadCount === 1 ? makeTask() : latestTask);
            }
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && init?.method === "PATCH") {
                return jsonResponse({ code: "AGENT_TASK_CONFLICT", reason: "revision-mismatch", snapshot: latestTask }, { ok: false, status: 409 });
            }
            return jsonResponse([]);
        });

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.task); });
        await act(async () => {
            await result.current.patchTask(
                TASK_IDS.task,
                [{ op: "set", field: "name", value: "충돌 입력" }],
                { clientEventId: TASK_IDS.event },
            );
        });
        expect(result.current.taskNeedsReconciliation).toBe(true);
        expect(result.current.errorState?.code).toBe("task_conflict");

        let refreshed = false;
        await act(async () => { refreshed = await result.current.refreshTask(); });

        expect(refreshed).toBe(true);
        expect(result.current.taskNeedsReconciliation).toBe(false);
        expect(result.current.errorState).toBeNull();
        expect(result.current.taskSnapshot?.revision).toBe(3);
    });

    it("exposes mutation busy and pending state while a task request is in flight", async () => {
        let resolvePatch: ((response: Response) => void) | undefined;
        const nextTask = makeTask({ revision: 3, currentSnapshotRef: TASK_IDS.snapshot3 });
        const fetchMock = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && !init?.method) return jsonResponse(makeTask());
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && init?.method === "PATCH") {
                return new Promise<Response>((resolve) => { resolvePatch = resolve; });
            }
            return jsonResponse([]);
        });
        global.fetch = fetchMock;

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.task); });
        let mutation: Promise<unknown> | undefined;
        act(() => {
            mutation = result.current.patchTask(TASK_IDS.task, [{ op: "set", field: "name", value: "김하나" }], { clientEventId: TASK_IDS.event });
        });
        await waitFor(() => expect(result.current.taskMutationInFlight).toBe(true));
        expect(result.current.taskPendingEventIds).toContain(TASK_IDS.event);

        resolvePatch?.(jsonResponse({
            receipt: { taskId: TASK_IDS.task, eventId: TASK_IDS.event, eventHash: "a".repeat(64), acceptedRevision: 3, currentSnapshotRef: TASK_IDS.snapshot3 },
            snapshot: nextTask,
        }));
        await act(async () => { await mutation; });
        expect(result.current.taskMutationInFlight).toBe(false);
        expect(result.current.taskPendingEventIds).toEqual([]);
    });

    it("keeps uncertain task events pending until an authoritative refresh", async () => {
        let readCount = 0;
        const latestTask = makeTask({ revision: 3, currentSnapshotRef: TASK_IDS.snapshot3 });
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && !init?.method) {
                readCount += 1;
                return jsonResponse(readCount === 1 ? makeTask() : latestTask);
            }
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && init?.method === "PATCH") throw new Error("connection lost");
            return jsonResponse([]);
        });

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.task); });
        await act(async () => {
            await result.current.patchTask(TASK_IDS.task, [{ op: "set", field: "name", value: "확인 필요" }], { clientEventId: TASK_IDS.event });
        });

        expect(result.current.taskNeedsReconciliation).toBe(true);
        expect(result.current.taskPendingEventIds).toContain(TASK_IDS.event);
        expect(result.current.errorState?.effectState).toBe("succeeded-unconfirmed");

        await act(async () => { await result.current.refreshTask(); });
        expect(result.current.taskNeedsReconciliation).toBe(false);
        expect(result.current.taskPendingEventIds).toEqual([]);
    });

    it("clears mutation pending state and preserves expiry after a 410 response", async () => {
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && !init?.method) return jsonResponse(makeTask());
            if (url.endsWith(`/tasks/${TASK_IDS.task}`) && init?.method === "PATCH") return jsonResponse({}, { ok: false, status: 410 });
            return jsonResponse([]);
        });

        const { result } = renderHook(() => useAgentChat());
        await act(async () => { await result.current.refreshTask(TASK_IDS.task); });
        await act(async () => {
            await result.current.patchTask(TASK_IDS.task, [{ op: "set", field: "name", value: "만료 확인" }], { clientEventId: TASK_IDS.event });
        });

        expect(result.current.errorState).toEqual({ code: "task_expired", message: "초안이 만료되었습니다. 새 업무를 시작해 주세요.", effectState: "nothing-happened" });
        expect(result.current.taskPendingEventIds).toEqual([]);
        expect(result.current.taskMutationInFlight).toBe(false);
    });
});

describe("mobile useAgentShellEnabled capability discovery", () => {
    const originalFlag = process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED;

    beforeEach(() => {
        process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED = "true";
    });

    afterEach(() => {
        if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED;
        else process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED = originalFlag;
    });

    it.each([403, 503])("fails closed for an HTTP %s capability response", async (status) => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status } as Response);

        const { result } = renderHook(() => useAgentShellEnabled());

        expect(result.current).toBe("loading");
        await waitFor(() => expect(result.current).toBe("discovery-error"));
    });

    it("fails closed when capability discovery rejects", async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error("sensitive provider response"));

        const { result } = renderHook(() => useAgentShellEnabled());

        await waitFor(() => expect(result.current).toBe("discovery-error"));
        expect(result.current).not.toBe(false);
    });

    it("fails closed when capability JSON is malformed", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockRejectedValue(new Error("raw response details")),
        } as unknown as Response);

        const { result } = renderHook(() => useAgentShellEnabled());

        await waitFor(() => expect(result.current).toBe("discovery-error"));
    });

    it.each([
        ["empty", []],
        ["unusable", [{}]],
    ])("fails closed for an %s capability catalog", async (_label, catalog) => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => catalog,
        } as unknown as Response);

        const { result } = renderHook(() => useAgentShellEnabled());

        await waitFor(() => expect(result.current).toBe("discovery-error"));
    });

    it("enables the shell for a usable capability catalog", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => [{
                name: "clients.search",
                domain: "clients",
                version: "1.0.0",
                description: "Search clients",
                risk: "read",
                requiredRoles: ["owner"],
                renderer: "entity-choice",
                flagKey: "agent.capability.clients.search",
                sideEffect: false,
            }],
        } as unknown as Response);

        const { result } = renderHook(() => useAgentShellEnabled());

        await waitFor(() => expect(result.current).toBe("enabled"));
    });

    it("keeps explicit compatibility-off mode out of discovery and on legacy chat", () => {
        process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED = "false";
        global.fetch = jest.fn();

        const { result } = renderHook(() => useAgentShellEnabled());

        expect(result.current).toBe("compatibility-off");
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
