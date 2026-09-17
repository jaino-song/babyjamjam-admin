"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
    acceptAgentTaskSnapshot,
    AgentCapabilityMetaSchema,
    AgentTaskMutationResponseSchema,
    AgentTaskReferenceSchema,
    AgentTaskSchema,
    AgentTaskSnapshotPartSchema,
    captureAgentTaskSnapshotRequest,
    createAgentTaskSnapshotState,
    resetAgentTaskSnapshotState,
    type AgentTask,
    type AgentTaskClientSnapshotState,
    type AgentTaskMutationResponse,
    type AgentTaskPatchRequest,
} from "@babyjamjam/shared/agent";

const AGENT_SESSION_KEY = "agent_session_id";

class SessionOperationEpoch {
    #value = 0;

    read(): number {
        return this.#value;
    }

    next(): number {
        this.#value += 1;
        return this.#value;
    }
}

export type AgentSessionSummary = {
    id: string;
    title: string | null;
    updatedAt: string;
    messages?: UIMessage[];
};

export type AgentClientError = {
    code: string;
    message: string;
    effectState: "nothing-happened" | "succeeded-unconfirmed" | "partial";
};

export type AgentTaskClientError = {
    code: string;
    message: string;
    taskId?: string;
    latestRevision?: number;
};

export type AgentTaskMutationOptions = {
    expectedRevision: number;
    clientEventId: string;
};

export type AgentTaskCommand =
    | { command: "select-target"; choiceSetId: string; optionId: string }
    | { command: "select-target"; choiceSetRef: string; optionId: string }
    | { command: "start-update"; targetRef: string; expectedTargetVersion: string }
    | { command: "pause" }
    | { command: "resume" }
    | { command: "prepare-review" }
    | { command: "cancel" };

function createClientEventId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    const random = () => Math.floor(Math.random() * 0x1_0000).toString(16).padStart(4, "0");
    return `${random()}${random()}${random()}${random()}-${random()}-4${random().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${random().slice(1)}-${random()}${random()}${random()}`;
}

function readJsonBody(response: Response): Promise<unknown> {
    if (typeof response.json !== "function") return Promise.resolve(undefined);
    return response.json().catch(() => undefined);
}

function readAgentTask(value: unknown): AgentTask | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const candidate = record.snapshot ?? record.task ?? value;
    const parsed = AgentTaskSchema.safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
}

function readMutationResponse(value: unknown): AgentTaskMutationResponse | undefined {
    const parsed = AgentTaskMutationResponseSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

function readActionErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" && code.length > 0 ? code : undefined;
}

function actionErrorFromStatus(status: unknown, serverErrorCode: string | undefined, fallbackCode: string, fallbackMessage: string): AgentClientError {
    if (status === "uncertain" || status === "succeeded") {
        return { code: serverErrorCode ?? "action_result_unconfirmed", message: "서버 작업 기록을 새로고침해 최종 결과를 확인해 주세요.", effectState: "succeeded-unconfirmed" };
    }
    if (status === "failed" && serverErrorCode === "execution_failed") {
        return { code: serverErrorCode, message: fallbackMessage, effectState: "nothing-happened" };
    }
    if (status === "failed" || status === "executing") {
        return { code: serverErrorCode ?? "action_partial", message: "작업의 일부 단계가 실행되었을 수 있습니다. 기록 확인 전에는 다시 실행하지 마세요.", effectState: "partial" };
    }
    return { code: serverErrorCode ?? fallbackCode, message: fallbackMessage, effectState: "nothing-happened" };
}

function isTruthy(value: string | undefined): boolean {
    return value === "1" || value?.toLowerCase() === "true";
}

export type AgentShellState = "compatibility-off" | "loading" | "enabled" | "discovery-error";
export const AGENT_DISCOVERY_ERROR_MESSAGE = "AI 운영 코파일럿을 준비하지 못했습니다.";

function isUsableCapabilityCatalog(value: unknown): boolean {
    return Array.isArray(value)
        && value.length > 0
        && value.every((capability) => AgentCapabilityMetaSchema.safeParse(capability).success);
}

function readAgentSessionId(): string | null {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(AGENT_SESSION_KEY);
}

function makeAgentTransport(transportFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    return new DefaultChatTransport({
        api: "/api/ai/agent/chat",
        credentials: "same-origin",
        prepareSendMessagesRequest: ({ messages, body }) => ({
            body: { ...body, messages: messages.slice(-1) },
        }),
        fetch: transportFetch,
        body: () => ({
            sessionId: typeof window === "undefined" ? undefined : window.sessionStorage.getItem(AGENT_SESSION_KEY) ?? undefined,
            locale: "ko",
        }),
    });
}

export function useAgentShellEnabled(): AgentShellState {
    const shellConfigured = isTruthy(process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED);
    const [state, setState] = useState<AgentShellState>(shellConfigured ? "loading" : "compatibility-off");
    useEffect(() => {
        if (!shellConfigured) return;
        let active = true;
        void (async () => {
            try {
                const response = await fetch("/api/ai/agent/capabilities", { credentials: "same-origin" });
                if (!response.ok) throw new Error("Capability discovery failed");
                const capabilities: unknown = await response.json();
                if (!isUsableCapabilityCatalog(capabilities)) throw new Error("Capability catalog unavailable");
                if (active) setState("enabled");
            } catch {
                if (active) setState("discovery-error");
            }
        })();
        return () => { active = false; };
    }, [shellConfigured]);
    return state;
}

export function useAgentChat() {
    const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
    const [actionError, setActionError] = useState<AgentClientError | null>(null);
    const [taskSnapshotState, setTaskSnapshotState] = useState<AgentTaskClientSnapshotState>(() => createAgentTaskSnapshotState());
    const [taskError, setTaskError] = useState<AgentTaskClientError | null>(null);
    const restoredSession = useRef(false);
    const activeSessionIdRef = useRef<string | null>(readAgentSessionId());
    const sessionSelectionGenerationRef = useRef(new Map<string, number>());
    const invalidatedSelectionGenerationRef = useRef(new Map<string, number>());
    const sessionListGenerationRef = useRef(0);
    const sessionOperationEpoch = useMemo(() => new SessionOperationEpoch(), []);
    const structuredFormSubmissionInFlightRef = useRef(false);
    const taskSnapshotStateRef = useRef(taskSnapshotState);
    const handledTaskSnapshotRef = useRef(new Map<string, string>());

    const commitTaskSnapshotState = useCallback((next: AgentTaskClientSnapshotState) => {
        taskSnapshotStateRef.current = next;
        setTaskSnapshotState(next);
    }, []);

    const resetTaskSnapshot = useCallback((nextIdentityEpoch?: number) => {
        const current = taskSnapshotStateRef.current;
        const next = resetAgentTaskSnapshotState(current, nextIdentityEpoch ?? current.identityEpoch + 1);
        handledTaskSnapshotRef.current.clear();
        commitTaskSnapshotState(next);
        setTaskError(null);
    }, [commitTaskSnapshotState]);

    const beginTaskSnapshotRequest = useCallback(() => {
        const current = taskSnapshotStateRef.current;
        if (current.requestGeneration >= Number.MAX_SAFE_INTEGER) {
            throw new Error("Task snapshot request generation exhausted");
        }
        const next = { ...current, requestGeneration: current.requestGeneration + 1 };
        commitTaskSnapshotState(next);
        return captureAgentTaskSnapshotRequest(next);
    }, [commitTaskSnapshotState]);

    const acceptTaskSnapshotEnvelope = useCallback((
        envelope: Parameters<typeof acceptAgentTaskSnapshot>[1],
        request: Parameters<typeof acceptAgentTaskSnapshot>[2],
    ) => {
        const acceptance = acceptAgentTaskSnapshot(taskSnapshotStateRef.current, envelope, request);
        if (acceptance.state !== taskSnapshotStateRef.current) commitTaskSnapshotState(acceptance.state);
        return acceptance;
    }, [commitTaskSnapshotState]);

    const loadTaskSnapshot = useCallback(async (taskId: string, expectedOperationEpoch?: number): Promise<AgentTask | null> => {
        if (!AgentTaskReferenceSchema.safeParse(taskId).success) return null;
        const request = beginTaskSnapshotRequest();
        let response: Response;
        try {
            response = await fetch(`/api/ai/agent/tasks/${encodeURIComponent(taskId)}`, { credentials: "same-origin" });
        } catch {
            setTaskError({ code: "task_snapshot_unavailable", taskId, message: "작업 초안을 불러오지 못했습니다." });
            return null;
        }
        if (expectedOperationEpoch !== undefined && expectedOperationEpoch !== sessionOperationEpoch.read()) return null;
        const body = await readJsonBody(response);
        const task = readAgentTask(body);
        if (!response.ok || !task) {
            if (response.status === 410) setTaskError({ code: "task_gone", taskId, message: "이 작업 초안은 더 이상 사용할 수 없습니다.", });
            else if (response.ok) setTaskError({ code: "task_snapshot_invalid", taskId, message: "작업 초안 형식을 확인하지 못했습니다." });
            return null;
        }
        const envelope = {
            identityEpoch: request.identityEpoch,
            task,
        } as Parameters<typeof acceptAgentTaskSnapshot>[1];
        const acceptance = acceptTaskSnapshotEnvelope(envelope, request);
        if (acceptance.accepted && acceptance.needsReconciliation) {
            setTaskError({ code: "task_reconciliation_required", taskId, latestRevision: task.revision, message: "최신 작업 초안을 확인한 뒤 변경 내용을 다시 검토해 주세요." });
        }
        return acceptance.state.task;
    }, [acceptTaskSnapshotEnvelope, beginTaskSnapshotRequest, sessionOperationEpoch]);

    const applyTaskMutationResponse = useCallback((
        taskId: string,
        request: Parameters<typeof acceptAgentTaskSnapshot>[2],
        body: unknown,
    ): AgentTask | null => {
        const mutation = readMutationResponse(body);
        if (!mutation || mutation.snapshot.taskId !== taskId) return null;
        const envelope = {
            identityEpoch: request.identityEpoch,
            task: mutation.snapshot,
            acknowledgedEventId: mutation.receipt.eventId,
        } as Parameters<typeof acceptAgentTaskSnapshot>[1];
        const acceptance = acceptTaskSnapshotEnvelope(envelope, request);
        if (acceptance.accepted) setTaskError(null);
        return acceptance.state.task;
    }, [acceptTaskSnapshotEnvelope]);

    const handleTaskConflict = useCallback((
        taskId: string,
        request: Parameters<typeof acceptAgentTaskSnapshot>[2],
        body: unknown,
    ) => {
        const latestTask = readAgentTask(body);
        if (latestTask && latestTask.taskId === taskId) {
            const envelope = {
                identityEpoch: request.identityEpoch,
                task: latestTask,
                conflict: { status: 409, latestRevision: latestTask.revision },
            } as Parameters<typeof acceptAgentTaskSnapshot>[1];
            acceptTaskSnapshotEnvelope(envelope, request);
            setTaskError({ code: "task_conflict", taskId, latestRevision: latestTask.revision, message: "작업이 변경되었습니다. 최신 초안을 확인한 뒤 다시 시도해 주세요." });
            return latestTask;
        }
        setTaskError({ code: "task_conflict", taskId, message: "작업이 변경되었습니다. 최신 초안을 불러와 확인해 주세요." });
        return null;
    }, [acceptTaskSnapshotEnvelope]);

    const patchTask = useCallback(async (
        taskId: string,
        operations: AgentTaskPatchRequest["operations"],
        options: AgentTaskMutationOptions,
    ): Promise<AgentTask | null> => {
        if (!AgentTaskReferenceSchema.safeParse(taskId).success) return null;
        const request = beginTaskSnapshotRequest();
        const pending = taskSnapshotStateRef.current.pendingEventIds.includes(options.clientEventId)
            ? taskSnapshotStateRef.current.pendingEventIds
            : [...taskSnapshotStateRef.current.pendingEventIds, options.clientEventId];
        commitTaskSnapshotState({ ...taskSnapshotStateRef.current, pendingEventIds: pending });
        let response: Response;
        try {
            response = await fetch(`/api/ai/agent/tasks/${encodeURIComponent(taskId)}`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ clientEventId: options.clientEventId, expectedRevision: options.expectedRevision, operations }),
            });
        } catch {
            setTaskError({ code: "task_mutation_unconfirmed", taskId, message: "초안 변경 요청의 최종 결과를 확인하지 못했습니다. 같은 요청을 다시 보내지 마세요." });
            return null;
        }
        const body = await readJsonBody(response);
        if (response.status === 409) return handleTaskConflict(taskId, request, body);
        if (!response.ok) {
            setTaskError({ code: "task_patch_failed", taskId, message: "초안 변경을 적용하지 못했습니다." });
            return null;
        }
        const next = applyTaskMutationResponse(taskId, request, body);
        if (!next) setTaskError({ code: "task_patch_invalid", taskId, message: "초안 변경 응답을 확인하지 못했습니다." });
        return next;
    }, [applyTaskMutationResponse, beginTaskSnapshotRequest, commitTaskSnapshotState, handleTaskConflict]);

    const commandTask = useCallback(async (
        taskId: string,
        command: AgentTaskCommand,
        options: AgentTaskMutationOptions,
    ): Promise<AgentTask | null> => {
        if (!AgentTaskReferenceSchema.safeParse(taskId).success) return null;
        const request = beginTaskSnapshotRequest();
        const pending = taskSnapshotStateRef.current.pendingEventIds.includes(options.clientEventId)
            ? taskSnapshotStateRef.current.pendingEventIds
            : [...taskSnapshotStateRef.current.pendingEventIds, options.clientEventId];
        commitTaskSnapshotState({ ...taskSnapshotStateRef.current, pendingEventIds: pending });
        let response: Response;
        try {
            response = await fetch(`/api/ai/agent/tasks/${encodeURIComponent(taskId)}/commands`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ...command, clientEventId: options.clientEventId, expectedRevision: options.expectedRevision }),
            });
        } catch {
            setTaskError({ code: "task_command_unconfirmed", taskId, message: "작업 명령의 최종 결과를 확인하지 못했습니다. 같은 요청을 다시 보내지 마세요." });
            return null;
        }
        const body = await readJsonBody(response);
        if (response.status === 409) return handleTaskConflict(taskId, request, body);
        if (!response.ok) {
            setTaskError({ code: "task_command_failed", taskId, message: "작업 명령을 적용하지 못했습니다." });
            return null;
        }
        const next = applyTaskMutationResponse(taskId, request, body);
        if (!next) setTaskError({ code: "task_command_invalid", taskId, message: "작업 명령 응답을 확인하지 못했습니다." });
        return next;
    }, [applyTaskMutationResponse, beginTaskSnapshotRequest, commitTaskSnapshotState, handleTaskConflict]);

    const refreshSessions = useCallback(async () => {
        const requestGeneration = ++sessionListGenerationRef.current;
        const requestEpoch = sessionOperationEpoch.read();
        const response = await fetch("/api/ai/agent/sessions", { credentials: "same-origin" });
        if (!response.ok) return;
        const next = await response.json() as AgentSessionSummary[];
        if (requestGeneration !== sessionListGenerationRef.current) return;
        if (requestEpoch !== sessionOperationEpoch.read()) return;
        setSessions(Array.isArray(next) ? next : []);
    }, [sessionOperationEpoch]);

    const transportFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestEpoch = sessionOperationEpoch.read();
        const response = await fetch(input, init);
        const sessionId = response.headers.get("x-agent-session-id");
        if (requestEpoch === sessionOperationEpoch.read() && sessionId && typeof window !== "undefined") {
            window.sessionStorage.setItem(AGENT_SESSION_KEY, sessionId);
        }
        return response;
    }, [sessionOperationEpoch]);
    const transport = useMemo(() => makeAgentTransport(transportFetch), [transportFetch]);
    const chat = useChat({
        transport,
        experimental_throttle: 50,
        onFinish: () => { void refreshSessions(); },
    });

    useEffect(() => {
        const latest = (chat?.messages ?? [])
            .slice()
            .reverse()
            .flatMap((message) => message.parts.slice().reverse().map((part) => ({ messageId: message.id, part })))
            .map(({ messageId, part }) => {
                if (part.type !== "data-task-snapshot") return null;
                const parsed = AgentTaskSnapshotPartSchema.safeParse((part as { data?: unknown }).data);
                return parsed.success ? { messageId, data: parsed.data } : null;
            })
            .find((value): value is { messageId: string; data: ReturnType<typeof AgentTaskSnapshotPartSchema.parse> } => value !== null);
        if (!latest) return;
        const marker = `${latest.messageId}:${latest.data.snapshotRef}:${latest.data.revision}`;
        if (handledTaskSnapshotRef.current.get(latest.data.taskId) === marker) return;
        handledTaskSnapshotRef.current.set(latest.data.taskId, marker);
        queueMicrotask(() => { void loadTaskSnapshot(latest.data.taskId).catch(() => undefined); });
    }, [chat?.messages, loadTaskSnapshot]);

    const selectSession = useCallback(async (sessionId: string) => {
        const selectionGeneration = (sessionSelectionGenerationRef.current.get(sessionId) ?? 0) + 1;
        sessionSelectionGenerationRef.current.set(sessionId, selectionGeneration);
        const operationEpoch = sessionOperationEpoch.next();
        resetTaskSnapshot();
        chat.stop();
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, { credentials: "same-origin" });
        if (operationEpoch !== sessionOperationEpoch.read()) return;
        if ((invalidatedSelectionGenerationRef.current.get(sessionId) ?? 0) >= selectionGeneration) return;
        if (!response.ok) {
            if (activeSessionIdRef.current === sessionId) activeSessionIdRef.current = null;
            if (typeof window !== "undefined" && window.sessionStorage.getItem(AGENT_SESSION_KEY) === sessionId) {
                window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            }
            return;
        }
        const session = await response.json() as AgentSessionSummary & { activeTaskId?: unknown };
        if (operationEpoch !== sessionOperationEpoch.read()) return;
        if ((invalidatedSelectionGenerationRef.current.get(sessionId) ?? 0) >= selectionGeneration) return;
        activeSessionIdRef.current = session.id;
        if (typeof window !== "undefined") window.sessionStorage.setItem(AGENT_SESSION_KEY, session.id);
        chat.setMessages(session.messages ?? []);
        if (typeof session.activeTaskId === "string") await loadTaskSnapshot(session.activeTaskId, operationEpoch);
    }, [chat, loadTaskSnapshot, resetTaskSnapshot, sessionOperationEpoch]);

    const refreshCurrentSession = useCallback(async () => {
        const sessionId = readAgentSessionId();
        if (!sessionId) return;
        const requestEpoch = sessionOperationEpoch.read();
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, { credentials: "same-origin" });
        if (!response.ok) return;
        const session = await response.json() as AgentSessionSummary;
        if (requestEpoch !== sessionOperationEpoch.read()) return;
        chat.setMessages(session.messages ?? []);
    }, [chat, sessionOperationEpoch]);

    useEffect(() => {
        if (restoredSession.current) return;
        restoredSession.current = true;
        queueMicrotask(() => {
            void (async () => {
                const sessionId = window.sessionStorage.getItem(AGENT_SESSION_KEY);
                if (sessionId) {
                    await selectSession(sessionId).catch(() => window.sessionStorage.removeItem(AGENT_SESSION_KEY));
                }
                await refreshSessions();
            })();
        });
    }, [refreshSessions, selectSession]);

    const resolveActionError = useCallback(async (actionId: string, fallbackCode: string, fallbackMessage: string) => {
        await refreshCurrentSession().catch(() => undefined);
        try {
            const response = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}`, { credentials: "same-origin" });
            if (!response.ok) return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다. 중복 실행하지 마세요.", effectState: "succeeded-unconfirmed" as const };
            const action = await response.json() as { status?: unknown; error?: unknown };
            return actionErrorFromStatus(action.status, readActionErrorCode(action.error), fallbackCode, fallbackMessage);
        } catch {
            return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다. 중복 실행하지 마세요.", effectState: "succeeded-unconfirmed" as const };
        }
    }, [refreshCurrentSession]);

    const approveAction = useCallback(async (actionId: string, expectedRevision: string, acknowledgementToken?: string) => {
        setActionError(null);
        try {
            const response = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}/approve`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedRevision, ...(acknowledgementToken ? { acknowledgementToken } : {}) }),
            });
            await refreshCurrentSession();
            if (!response.ok) setActionError(await resolveActionError(actionId, "approval_failed", "승인된 작업을 완료하지 못했습니다."));
        } catch {
            setActionError(await resolveActionError(actionId, "approval_unconfirmed", "승인 요청의 최종 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const rejectAction = useCallback(async (actionId: string) => {
        setActionError(null);
        try {
            const response = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}/reject`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            });
            await refreshCurrentSession();
            if (!response.ok) setActionError(await resolveActionError(actionId, "rejection_failed", "거절 요청을 완료하지 못했습니다."));
        } catch {
            setActionError(await resolveActionError(actionId, "rejection_unconfirmed", "거절 요청의 최종 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const submitStructuredForm = useCallback((formId: string, values: Record<string, unknown>) => {
        if (structuredFormSubmissionInFlightRef.current || chat.status === "submitted" || chat.status === "streaming") return;
        structuredFormSubmissionInFlightRef.current = true;
        const clearSubmissionGuard = () => { structuredFormSubmissionInFlightRef.current = false; };
        try {
            void Promise.resolve(chat.sendMessage({
                role: "user",
                parts: [{ type: "data-form-submit", data: { formId, values } }],
            } as never)).then(clearSubmissionGuard, clearSubmissionGuard);
        } catch {
            clearSubmissionGuard();
        }
    }, [chat]);

    const submitFeedback = useCallback(async (messageId: string, type: "positive" | "negative", comment?: string) => {
        const sessionId = typeof window === "undefined" ? null : window.sessionStorage.getItem(AGENT_SESSION_KEY);
        if (!sessionId) return;
        await fetch("/api/ai/agent/feedback", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, messageId, type, ...(comment ? { comment } : {}) }),
        });
    }, []);

    const invalidatePendingSelection = useCallback((sessionId: string) => {
        const selectionGeneration = sessionSelectionGenerationRef.current.get(sessionId);
        if (selectionGeneration === undefined) return;
        const previousInvalidation = invalidatedSelectionGenerationRef.current.get(sessionId) ?? 0;
        if (selectionGeneration > previousInvalidation) {
            invalidatedSelectionGenerationRef.current.set(sessionId, selectionGeneration);
        }
    }, []);

    const deleteSession = useCallback(async (sessionId: string) => {
        sessionListGenerationRef.current += 1;
        activeSessionIdRef.current = readAgentSessionId();
        const deletingActiveSession = activeSessionIdRef.current === sessionId;
        if (deletingActiveSession) {
            sessionOperationEpoch.next();
            chat.stop();
        }
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) return;
        invalidatePendingSelection(sessionId);
        const activeSessionAtResponse = activeSessionIdRef.current === sessionId;
        if (activeSessionAtResponse) {
            sessionOperationEpoch.next();
            chat.stop();
            activeSessionIdRef.current = null;
            window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            chat.setMessages([]);
            resetTaskSnapshot();
        }
        await refreshSessions();
    }, [chat, invalidatePendingSelection, refreshSessions, resetTaskSnapshot, sessionOperationEpoch]);

    const renameSession = useCallback(async (sessionId: string, title: string) => {
        const nextTitle = title.trim();
        if (!nextTitle) return false;
        sessionListGenerationRef.current += 1;
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: nextTitle }),
        });
        if (!response.ok) return false;
        await refreshSessions();
        return true;
    }, [refreshSessions]);

    const archiveSession = useCallback(async (sessionId: string) => {
        sessionListGenerationRef.current += 1;
        activeSessionIdRef.current = readAgentSessionId();
        const archivingActiveSession = activeSessionIdRef.current === sessionId;
        if (archivingActiveSession) {
            sessionOperationEpoch.next();
            chat.stop();
        }
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ archived: true }),
        });
        if (!response.ok) return;
        invalidatePendingSelection(sessionId);
        const activeSessionAtResponse = activeSessionIdRef.current === sessionId;
        if (activeSessionAtResponse) {
            sessionOperationEpoch.next();
            chat.stop();
            activeSessionIdRef.current = null;
            window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            chat.setMessages([]);
            resetTaskSnapshot();
        }
        await refreshSessions();
    }, [chat, invalidatePendingSelection, refreshSessions, resetTaskSnapshot, sessionOperationEpoch]);

    const resetBranch = () => {
        sessionListGenerationRef.current += 1;
        sessionOperationEpoch.next();
        chat.stop();
        activeSessionIdRef.current = null;
        if (typeof window !== "undefined") window.sessionStorage.removeItem(AGENT_SESSION_KEY);
        chat.setMessages([]);
        setActionError(null);
        resetTaskSnapshot();
        void refreshSessions();
    };

    return {
        ...chat,
        actionError,
        taskSnapshotState,
        taskError,
        createTaskEventId: createClientEventId,
        loadTaskSnapshot,
        patchTask,
        commandTask,
        clearActionError: () => setActionError(null),
        clearTaskError: () => setTaskError(null),
        resetBranch,
        sessions,
        refreshSessions,
        selectSession,
        renameSession,
        archiveSession,
        deleteSession,
        approveAction,
        rejectAction,
        submitStructuredForm,
        submitFeedback,
    };
}
