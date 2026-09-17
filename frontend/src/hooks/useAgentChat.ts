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
    pendingEventId?: string;
};

export type AgentTaskAccessState = {
    status: "idle" | "loading" | "authorized" | "auth-required" | "forbidden" | "not-found" | "expired" | "unavailable";
    taskId?: string;
    httpStatus?: number;
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

type PendingTaskMutation =
    | { taskId: string; kind: "patch"; operations: AgentTaskPatchRequest["operations"]; options: AgentTaskMutationOptions }
    | { taskId: string; kind: "command"; command: AgentTaskCommand; options: AgentTaskMutationOptions };

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

function taskAccessFailure(status: number | undefined): Pick<AgentTaskAccessState, "status" | "httpStatus"> & Pick<AgentTaskClientError, "code" | "message"> {
    if (status === 401) return { status: "auth-required", httpStatus: status, code: "task_auth_required", message: "로그인이 만료되었습니다. 다시 로그인한 뒤 새 작업을 시작해 주세요." };
    if (status === 403) return { status: "forbidden", httpStatus: status, code: "task_forbidden", message: "현재 계정 또는 지점에서 이 작업에 접근할 권한이 없습니다. 권한을 확인한 뒤 새 작업을 시작해 주세요." };
    if (status === 404) return { status: "not-found", httpStatus: status, code: "task_not_found", message: "작업 초안을 찾을 수 없습니다. 새 작업을 시작해 주세요." };
    if (status === 410) return { status: "expired", httpStatus: status, code: "task_expired", message: "작업 초안이 만료되었습니다. 새 작업을 시작해 주세요." };
    return { status: "unavailable", ...(status === undefined ? {} : { httpStatus: status }), code: "task_snapshot_unavailable", message: "작업 초안을 확인할 수 없습니다. 새로고침한 뒤 다시 시도하거나 새 작업을 시작해 주세요." };
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
    const [taskAccessState, setTaskAccessState] = useState<AgentTaskAccessState>({ status: "idle" });
    const [taskMutationInFlight, setTaskMutationInFlight] = useState(false);
    const [taskNeedsReconciliation, setTaskNeedsReconciliation] = useState(false);
    const restoredSession = useRef(false);
    const activeSessionIdRef = useRef<string | null>(readAgentSessionId());
    const sessionSelectionGenerationRef = useRef(new Map<string, number>());
    const invalidatedSelectionGenerationRef = useRef(new Map<string, number>());
    const sessionListGenerationRef = useRef(0);
    const sessionOperationEpoch = useMemo(() => new SessionOperationEpoch(), []);
    const structuredFormSubmissionInFlightRef = useRef(false);
    const taskSnapshotStateRef = useRef(taskSnapshotState);
    const handledTaskSnapshotRef = useRef(new Map<string, string>());
    const taskAccessStateRef = useRef(taskAccessState);
    const taskMutationInFlightRef = useRef(false);
    const taskMutationTokenRef = useRef(0);
    const taskNeedsReconciliationRef = useRef(false);
    const pendingTaskMutationsRef = useRef(new Map<string, PendingTaskMutation>());

    const commitTaskSnapshotState = useCallback((next: AgentTaskClientSnapshotState) => {
        taskSnapshotStateRef.current = next;
        setTaskSnapshotState(next);
    }, []);

    const commitTaskAccessState = useCallback((next: AgentTaskAccessState) => {
        taskAccessStateRef.current = next;
        setTaskAccessState(next);
    }, []);

    const commitTaskNeedsReconciliation = useCallback((next: boolean) => {
        taskNeedsReconciliationRef.current = next;
        setTaskNeedsReconciliation(next);
    }, []);

    const commitTaskMutationInFlight = useCallback((next: boolean) => {
        taskMutationInFlightRef.current = next;
        setTaskMutationInFlight(next);
    }, []);

    const resetTaskSnapshot = useCallback((nextIdentityEpoch?: number) => {
        const current = taskSnapshotStateRef.current;
        const next = resetAgentTaskSnapshotState(current, nextIdentityEpoch ?? current.identityEpoch + 1);
        taskMutationTokenRef.current += 1;
        pendingTaskMutationsRef.current.clear();
        handledTaskSnapshotRef.current.clear();
        commitTaskSnapshotState(next);
        commitTaskAccessState({ status: "idle" });
        commitTaskNeedsReconciliation(false);
        commitTaskMutationInFlight(false);
        setTaskError(null);
    }, [commitTaskAccessState, commitTaskMutationInFlight, commitTaskNeedsReconciliation, commitTaskSnapshotState]);

    const beginTaskSnapshotRequest = useCallback(() => {
        const current = taskSnapshotStateRef.current;
        if (current.requestGeneration >= Number.MAX_SAFE_INTEGER) {
            throw new Error("Task snapshot request generation exhausted");
        }
        const next = { ...current, requestGeneration: current.requestGeneration + 1 };
        commitTaskSnapshotState(next);
        return captureAgentTaskSnapshotRequest(next);
    }, [commitTaskSnapshotState]);

    const isCurrentTaskRequest = useCallback((
        request: Parameters<typeof acceptAgentTaskSnapshot>[2],
        expectedOperationEpoch: number,
    ): boolean => (
        request.identityEpoch === taskSnapshotStateRef.current.identityEpoch
        && request.requestGeneration === taskSnapshotStateRef.current.requestGeneration
        && expectedOperationEpoch === sessionOperationEpoch.read()
    ), [sessionOperationEpoch]);

    const quarantineTask = useCallback((
        taskId: string,
        failure: Pick<AgentTaskAccessState, "status" | "httpStatus"> & Pick<AgentTaskClientError, "code" | "message">,
    ) => {
        const current = taskSnapshotStateRef.current;
        const reset = resetAgentTaskSnapshotState(current, current.identityEpoch + 1);
        handledTaskSnapshotRef.current.clear();
        commitTaskSnapshotState({ ...reset, pendingEventIds: current.pendingEventIds });
        commitTaskAccessState({ status: failure.status, taskId, ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }) });
        commitTaskNeedsReconciliation(true);
        setTaskError({ code: failure.code, taskId, message: failure.message });
    }, [commitTaskAccessState, commitTaskNeedsReconciliation, commitTaskSnapshotState]);

    const taskMutationBlocked = useCallback((taskId: string, clientEventId: string): boolean => {
        const state = taskSnapshotStateRef.current;
        if (taskAccessStateRef.current.status !== "authorized" || !state.task || state.task.taskId !== taskId) {
            setTaskError({ code: "task_not_authorized", taskId, message: "현재 권한이 확인된 작업 초안이 없습니다. 최신 초안을 불러온 뒤 다시 시도해 주세요." });
            return true;
        }
        if (taskMutationInFlightRef.current) {
            setTaskError({ code: "task_mutation_in_flight", taskId, message: "이전 초안 변경을 처리 중입니다. 결과를 확인한 뒤 다시 시도해 주세요." });
            return true;
        }
        if (taskNeedsReconciliationRef.current) {
            setTaskError({ code: "task_reconciliation_required", taskId, latestRevision: state.task.revision, message: "최신 작업 초안을 새로고침해 변경 결과를 확인한 뒤 다시 시도해 주세요." });
            return true;
        }
        if (state.pendingEventIds.length > 0 && !state.pendingEventIds.includes(clientEventId)) {
            setTaskError({ code: "task_pending_event", taskId, latestRevision: state.task.revision, pendingEventId: state.pendingEventIds[0], message: "확인되지 않은 초안 변경이 있습니다. 같은 변경의 결과를 확인한 뒤 새 변경을 시도해 주세요." });
            return true;
        }
        if (state.pendingEventIds.includes(clientEventId) && !pendingTaskMutationsRef.current.has(clientEventId)) {
            setTaskError({ code: "task_pending_event", taskId, latestRevision: state.task.revision, pendingEventId: clientEventId, message: "확인되지 않은 초안 변경이 있습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요." });
            return true;
        }
        return false;
    }, []);

    const setPendingTaskError = useCallback((taskId: string, message = "확인되지 않은 초안 변경이 있습니다. 최신 상태를 확인한 뒤 같은 변경을 다시 확인해 주세요."): boolean => {
        const state = taskSnapshotStateRef.current;
        const pendingEventId = state.pendingEventIds[0];
        if (!pendingEventId || !state.task || state.task.taskId !== taskId) return false;
        setTaskError({ code: "task_pending_event", taskId, latestRevision: state.task.revision, pendingEventId, message });
        return true;
    }, []);

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
        const operationEpoch = sessionOperationEpoch.read();
        if (expectedOperationEpoch !== undefined && expectedOperationEpoch !== operationEpoch) return null;
        const currentTaskId = taskSnapshotStateRef.current.task?.taskId ?? taskAccessStateRef.current.taskId;
        if (currentTaskId !== undefined && currentTaskId !== taskId) resetTaskSnapshot();
        const request = beginTaskSnapshotRequest();
        commitTaskAccessState({ status: "loading", taskId });
        let response: Response;
        try {
            response = await fetch(`/api/ai/agent/tasks/${encodeURIComponent(taskId)}`, { credentials: "same-origin" });
        } catch {
            if (isCurrentTaskRequest(request, operationEpoch)) quarantineTask(taskId, taskAccessFailure(undefined));
            return null;
        }
        if (!isCurrentTaskRequest(request, operationEpoch)) return null;
        const body = await readJsonBody(response);
        if (!isCurrentTaskRequest(request, operationEpoch)) return null;
        const task = readAgentTask(body);
        if (!response.ok || !task) {
            quarantineTask(taskId, taskAccessFailure(response.status));
            return null;
        }
        const envelope = {
            identityEpoch: request.identityEpoch,
            task,
        } as Parameters<typeof acceptAgentTaskSnapshot>[1];
        const acceptance = acceptTaskSnapshotEnvelope(envelope, request);
        if (!acceptance.accepted) {
            if (acceptance.reason === "same-revision") {
                commitTaskAccessState({ status: "authorized", taskId });
                commitTaskNeedsReconciliation(false);
                if (!setPendingTaskError(taskId)) setTaskError(null);
            }
            return acceptance.state.task;
        }
        commitTaskAccessState({ status: "authorized", taskId });
        commitTaskNeedsReconciliation(acceptance.needsReconciliation);
        if (acceptance.needsReconciliation) {
            setTaskError({ code: "task_reconciliation_required", taskId, latestRevision: task.revision, message: "최신 작업 초안을 확인한 뒤 변경 내용을 다시 검토해 주세요." });
        } else if (!setPendingTaskError(taskId)) {
            setTaskError(null);
        }
        return acceptance.state.task;
    }, [acceptTaskSnapshotEnvelope, beginTaskSnapshotRequest, commitTaskAccessState, commitTaskNeedsReconciliation, isCurrentTaskRequest, quarantineTask, resetTaskSnapshot, sessionOperationEpoch, setPendingTaskError]);

    const applyTaskMutationResponse = useCallback((
        taskId: string,
        request: Parameters<typeof acceptAgentTaskSnapshot>[2],
        operationEpoch: number,
        body: unknown,
    ): AgentTask | null => {
        if (!isCurrentTaskRequest(request, operationEpoch)) return taskSnapshotStateRef.current.task;
        const mutation = readMutationResponse(body);
        if (!mutation || mutation.snapshot.taskId !== taskId) return null;
        const envelope = {
            identityEpoch: request.identityEpoch,
            task: mutation.snapshot,
            acknowledgedEventId: mutation.receipt.eventId,
        } as Parameters<typeof acceptAgentTaskSnapshot>[1];
        const acceptance = acceptTaskSnapshotEnvelope(envelope, request);
        if (acceptance.accepted) {
            pendingTaskMutationsRef.current.delete(mutation.receipt.eventId);
            commitTaskAccessState({ status: "authorized", taskId });
            commitTaskNeedsReconciliation(acceptance.needsReconciliation);
            if (!acceptance.needsReconciliation && !setPendingTaskError(taskId)) setTaskError(null);
        }
        return acceptance.state.task;
    }, [acceptTaskSnapshotEnvelope, commitTaskAccessState, commitTaskNeedsReconciliation, isCurrentTaskRequest, setPendingTaskError]);

    const handleTaskConflict = useCallback((
        taskId: string,
        request: Parameters<typeof acceptAgentTaskSnapshot>[2],
        operationEpoch: number,
        body: unknown,
    ) => {
        if (!isCurrentTaskRequest(request, operationEpoch)) return taskSnapshotStateRef.current.task;
        const latestTask = readAgentTask(body);
        if (latestTask && latestTask.taskId === taskId) {
            const envelope = {
                identityEpoch: request.identityEpoch,
                task: latestTask,
                conflict: { status: 409, latestRevision: latestTask.revision },
            } as Parameters<typeof acceptAgentTaskSnapshot>[1];
            const acceptance = acceptTaskSnapshotEnvelope(envelope, request);
            if (!acceptance.accepted) return acceptance.state.task;
            commitTaskAccessState({ status: "authorized", taskId });
            commitTaskNeedsReconciliation(true);
            setTaskError({ code: "task_conflict", taskId, latestRevision: latestTask.revision, message: "작업이 변경되었습니다. 최신 초안을 확인한 뒤 다시 시도해 주세요." });
            return acceptance.state.task;
        }
        quarantineTask(taskId, {
            status: "unavailable",
            httpStatus: 409,
            code: "task_conflict_unresolved",
            message: "작업 변경 결과를 확인하지 못했습니다. 최신 초안을 새로고침한 뒤 다시 시도해 주세요.",
        });
        return null;
    }, [acceptTaskSnapshotEnvelope, commitTaskAccessState, commitTaskNeedsReconciliation, isCurrentTaskRequest, quarantineTask]);

    const patchTask = useCallback(async (
        taskId: string,
        operations: AgentTaskPatchRequest["operations"],
        options: AgentTaskMutationOptions,
    ): Promise<AgentTask | null> => {
        if (!AgentTaskReferenceSchema.safeParse(taskId).success) return null;
        if (taskMutationBlocked(taskId, options.clientEventId)) return null;
        const operationEpoch = sessionOperationEpoch.read();
        const request = beginTaskSnapshotRequest();
        const mutationToken = ++taskMutationTokenRef.current;
        const pending = taskSnapshotStateRef.current.pendingEventIds.includes(options.clientEventId)
            ? taskSnapshotStateRef.current.pendingEventIds
            : [...taskSnapshotStateRef.current.pendingEventIds, options.clientEventId];
        pendingTaskMutationsRef.current.set(options.clientEventId, { taskId, kind: "patch", operations, options });
        commitTaskSnapshotState({ ...taskSnapshotStateRef.current, pendingEventIds: pending });
        commitTaskMutationInFlight(true);
        try {
            let response: Response;
            try {
                response = await fetch(`/api/ai/agent/tasks/${encodeURIComponent(taskId)}`, {
                    method: "PATCH",
                    credentials: "same-origin",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ clientEventId: options.clientEventId, expectedRevision: options.expectedRevision, operations }),
                });
            } catch {
                if (isCurrentTaskRequest(request, operationEpoch)) {
                    commitTaskNeedsReconciliation(true);
                    setTaskError({ code: "task_mutation_unconfirmed", taskId, pendingEventId: options.clientEventId, message: "초안 변경 요청의 최종 결과를 확인하지 못했습니다. 새로고침으로 결과를 확인한 뒤 같은 변경을 다시 확인해 주세요." });
                }
                return null;
            }
            const body = await readJsonBody(response);
            if (!isCurrentTaskRequest(request, operationEpoch)) return taskSnapshotStateRef.current.task;
            if (response.status === 409) return handleTaskConflict(taskId, request, operationEpoch, body);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
                    quarantineTask(taskId, taskAccessFailure(response.status));
                } else {
                    commitTaskNeedsReconciliation(true);
                    setTaskError({ code: "task_patch_failed", taskId, message: "초안 변경을 적용하지 못했습니다. 최신 초안을 확인한 뒤 다시 시도해 주세요." });
                }
                return null;
            }
            const next = applyTaskMutationResponse(taskId, request, operationEpoch, body);
            if (!next && isCurrentTaskRequest(request, operationEpoch)) {
                commitTaskNeedsReconciliation(true);
                setTaskError({ code: "task_patch_invalid", taskId, pendingEventId: options.clientEventId, message: "초안 변경 응답을 확인하지 못했습니다. 최신 초안을 새로고침해 확인해 주세요." });
            }
            return next;
        } finally {
            if (taskMutationTokenRef.current === mutationToken) commitTaskMutationInFlight(false);
        }
    }, [applyTaskMutationResponse, beginTaskSnapshotRequest, commitTaskMutationInFlight, commitTaskNeedsReconciliation, commitTaskSnapshotState, handleTaskConflict, isCurrentTaskRequest, quarantineTask, sessionOperationEpoch, taskMutationBlocked]);

    const commandTask = useCallback(async (
        taskId: string,
        command: AgentTaskCommand,
        options: AgentTaskMutationOptions,
    ): Promise<AgentTask | null> => {
        if (!AgentTaskReferenceSchema.safeParse(taskId).success) return null;
        if (taskMutationBlocked(taskId, options.clientEventId)) return null;
        const operationEpoch = sessionOperationEpoch.read();
        const request = beginTaskSnapshotRequest();
        const mutationToken = ++taskMutationTokenRef.current;
        const pending = taskSnapshotStateRef.current.pendingEventIds.includes(options.clientEventId)
            ? taskSnapshotStateRef.current.pendingEventIds
            : [...taskSnapshotStateRef.current.pendingEventIds, options.clientEventId];
        pendingTaskMutationsRef.current.set(options.clientEventId, { taskId, kind: "command", command, options });
        commitTaskSnapshotState({ ...taskSnapshotStateRef.current, pendingEventIds: pending });
        commitTaskMutationInFlight(true);
        try {
            let response: Response;
            try {
                response = await fetch(`/api/ai/agent/tasks/${encodeURIComponent(taskId)}/commands`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ ...command, clientEventId: options.clientEventId, expectedRevision: options.expectedRevision }),
                });
            } catch {
                if (isCurrentTaskRequest(request, operationEpoch)) {
                    commitTaskNeedsReconciliation(true);
                    setTaskError({ code: "task_command_unconfirmed", taskId, pendingEventId: options.clientEventId, message: "작업 명령의 최종 결과를 확인하지 못했습니다. 새로고침으로 결과를 확인한 뒤 같은 변경을 다시 확인해 주세요." });
                }
                return null;
            }
            const body = await readJsonBody(response);
            if (!isCurrentTaskRequest(request, operationEpoch)) return taskSnapshotStateRef.current.task;
            if (response.status === 409) return handleTaskConflict(taskId, request, operationEpoch, body);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
                    quarantineTask(taskId, taskAccessFailure(response.status));
                } else {
                    commitTaskNeedsReconciliation(true);
                    setTaskError({ code: "task_command_failed", taskId, message: "작업 명령을 적용하지 못했습니다. 최신 초안을 확인한 뒤 다시 시도해 주세요." });
                }
                return null;
            }
            const next = applyTaskMutationResponse(taskId, request, operationEpoch, body);
            if (!next && isCurrentTaskRequest(request, operationEpoch)) {
                commitTaskNeedsReconciliation(true);
                setTaskError({ code: "task_command_invalid", taskId, pendingEventId: options.clientEventId, message: "작업 명령 응답을 확인하지 못했습니다. 최신 초안을 새로고침해 확인해 주세요." });
            }
            return next;
        } finally {
            if (taskMutationTokenRef.current === mutationToken) commitTaskMutationInFlight(false);
        }
    }, [applyTaskMutationResponse, beginTaskSnapshotRequest, commitTaskMutationInFlight, commitTaskNeedsReconciliation, commitTaskSnapshotState, handleTaskConflict, isCurrentTaskRequest, quarantineTask, sessionOperationEpoch, taskMutationBlocked]);

    const retryPendingTaskEvent = useCallback(async (taskId: string, clientEventId: string): Promise<AgentTask | null> => {
        const pending = pendingTaskMutationsRef.current.get(clientEventId);
        if (!pending || pending.taskId !== taskId) {
            setTaskError({ code: "task_pending_event_unrecoverable", taskId, pendingEventId: clientEventId, message: "확인되지 않은 변경 요청을 복원할 수 없습니다. 최신 초안을 확인한 뒤 새 작업을 시작해 주세요." });
            return null;
        }
        if (taskNeedsReconciliationRef.current) {
            const revision = taskSnapshotStateRef.current.task?.revision;
            setTaskError({ code: "task_reconciliation_required", taskId, ...(revision === undefined ? {} : { latestRevision: revision }), pendingEventId: clientEventId, message: "최신 작업 초안을 새로고침해 변경 결과를 확인한 뒤 같은 변경을 다시 확인해 주세요." });
            return null;
        }
        if (pending.kind === "patch") return patchTask(taskId, pending.operations, pending.options);
        return commandTask(taskId, pending.command, pending.options);
    }, [commandTask, patchTask]);

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
        taskAccessState,
        taskMutationInFlight,
        taskNeedsReconciliation,
        createTaskEventId: createClientEventId,
        loadTaskSnapshot,
        patchTask,
        commandTask,
        retryPendingTaskEvent,
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
