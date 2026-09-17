"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BjjUIMessage } from "@babyjamjam/shared";
import {
    acceptAgentTaskSnapshot,
    AgentCapabilityMetaSchema,
    AgentTaskCommandRequestSchema,
    AgentTaskMutationResponseSchema,
    AgentTaskPatchPartSchema,
    AgentTaskPatchRequestSchema,
    AgentTaskRestoreMetadataSchema,
    AgentTaskSchema,
    AgentTaskSnapshotEnvelopeSchema,
    AgentTaskSnapshotPartSchema,
    AgentEntitySelectPartSchema,
    captureAgentTaskSnapshotRequest,
    createAgentTaskSnapshotState,
    projectTaskForSafeChat,
    resetAgentTaskSnapshotState,
    type AgentTask,
    type AgentTaskClientSnapshotState,
    type AgentTaskRestoreMetadata,
    type ClientInputOperation,
} from "@babyjamjam/shared/agent";
import { z } from "zod";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";

export type MobileAgentMessage = Pick<BjjUIMessage, "id" | "role" | "parts">;
type MobileAgentPart = { type: string; text?: string; data?: unknown };
export type MobileAgentSessionSummary = {
    id: string;
    title: string | null;
    updatedAt: string;
    messages?: MobileAgentMessage[];
    activeTaskId?: string | null;
    pausedTaskIds?: string[];
    taskRestoreStatus?: AgentTaskRestoreMetadata["taskRestoreStatus"];
    recoveryTaskIds?: string[];
};
export type MobileAgentError = { code: string; message: string; effectState: "nothing-happened" | "succeeded-unconfirmed" | "partial" };
export type MobileAgentTaskSnapshot = z.infer<typeof AgentTaskSnapshotPartSchema>;
export type MobileAgentTaskCommand =
    | { command: "pause" }
    | { command: "resume" }
    | { command: "prepare-review" }
    | { command: "cancel" }
    | { command: "select-target"; choiceSetRef?: string; choiceSetId?: string; optionId: string }
    | { command: "start-update"; targetRef: string; expectedTargetVersion: string };
export type MobileAgentTaskMutationResult = {
    status: "applied" | "conflict" | "failed";
    task?: AgentTask;
    snapshot?: MobileAgentTaskSnapshot;
};
const AGENT_SESSION_KEY = "agent_session_id";

function readActionErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" && code.length > 0 ? code : undefined;
}

function actionErrorFromStatus(status: unknown, serverErrorCode: string | undefined, fallbackMessage: string): MobileAgentError {
    if (status === "uncertain" || status === "succeeded") {
        return { code: serverErrorCode ?? "action_unconfirmed", message: "최종 결과를 기록에서 확인해 주세요.", effectState: "succeeded-unconfirmed" };
    }
    if (status === "failed" && serverErrorCode === "execution_failed") {
        return { code: serverErrorCode, message: fallbackMessage, effectState: "nothing-happened" };
    }
    if (status === "failed" || status === "executing") {
        return { code: serverErrorCode ?? "action_partial", message: "일부 단계가 실행되었을 수 있습니다.", effectState: "partial" };
    }
    return { code: serverErrorCode ?? "action_failed", message: fallbackMessage, effectState: "nothing-happened" };
}

function makeId(): string { return `mobile-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function makeTaskEventId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    const random = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(12, "0").slice(-12);
    return `00000000-0000-4000-8000-${random}`;
}

function taskSnapshotPartFromTask(task: AgentTask): MobileAgentTaskSnapshot {
    const safe = projectTaskForSafeChat(task);
    return AgentTaskSnapshotPartSchema.parse({
        taskId: safe.taskId,
        snapshotRef: safe.currentSnapshotRef,
        kind: safe.kind,
        capabilityId: safe.capabilityId,
        revision: safe.revision,
        state: safe.state,
        fieldStatus: safe.fieldStatus.map(({ field, status }) => ({ field, status })),
    });
}

function taskRevisionFor(taskId: string, state: AgentTaskClientSnapshotState, snapshot: MobileAgentTaskSnapshot | null): number | undefined {
    if (snapshot?.taskId === taskId) return snapshot.revision;
    if (state.task?.taskId === taskId) return state.task.revision;
    return undefined;
}

function parseTaskRestoreMetadata(session: MobileAgentSessionSummary): AgentTaskRestoreMetadata | null {
    const hasMetadata = ["activeTaskId", "pausedTaskIds", "taskRestoreStatus", "recoveryTaskIds"]
        .some((field) => Object.prototype.hasOwnProperty.call(session, field));
    if (!hasMetadata) return null;
    const parsed = AgentTaskRestoreMetadataSchema.safeParse({
        activeTaskId: session.activeTaskId ?? null,
        pausedTaskIds: session.pausedTaskIds ?? [],
        taskRestoreStatus: session.taskRestoreStatus ?? "available",
        recoveryTaskIds: session.recoveryTaskIds ?? [],
    });
    return parsed.success ? parsed.data : null;
}

function isTerminalTaskState(state: AgentTask["state"] | undefined): boolean {
    return state === "completed" || state === "failed" || state === "cancelled";
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

/** Resolve the effective server-side capability flag before mounting the new shell. */
export function useAgentShellEnabled(): AgentShellState {
    const shellConfigured = isTruthy(process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED);
    const [state, setState] = useState<AgentShellState>(shellConfigured ? "loading" : "compatibility-off");
    useEffect(() => {
        if (!shellConfigured) return;
        let active = true;
        void (async () => {
            try {
                const response = await authenticatedFetch("/api/ai/agent/capabilities", { credentials: "same-origin" });
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
    const [messages, setMessages] = useState<MobileAgentMessage[]>([]);
    const [status, setStatus] = useState<"ready" | "streaming" | "error">("ready");
    const [sessions, setSessions] = useState<MobileAgentSessionSummary[]>([]);
    const [errorState, setErrorState] = useState<MobileAgentError | null>(null);
    const [taskClientState, setTaskClientState] = useState<AgentTaskClientSnapshotState>(() => createAgentTaskSnapshotState());
    const [taskSnapshot, setTaskSnapshot] = useState<MobileAgentTaskSnapshot | null>(null);
    const [taskNeedsReconciliation, setTaskNeedsReconciliation] = useState(false);
    const sessionId = useRef<string | undefined>(undefined);
    const pendingSessionId = useRef<string | undefined>(undefined);
    const abortRef = useRef<AbortController | null>(null);
    const operationEpochRef = useRef(0);
    const taskClientStateRef = useRef(taskClientState);
    const taskSnapshotRef = useRef<MobileAgentTaskSnapshot | null>(null);
    /** undefined means no restore identity has been established yet; null is an authoritative "no active task". */
    const activeTaskIdRef = useRef<string | null | undefined>(undefined);

    const commitTaskClientState = useCallback((next: AgentTaskClientSnapshotState) => {
        taskClientStateRef.current = next;
        setTaskClientState(next);
    }, []);

    const resetTaskSnapshot = useCallback((nextIdentityEpoch?: number) => {
        const current = taskClientStateRef.current;
        const next = resetAgentTaskSnapshotState(current, nextIdentityEpoch ?? current.identityEpoch + 1);
        commitTaskClientState(next);
        taskSnapshotRef.current = null;
        setTaskSnapshot(null);
        setTaskNeedsReconciliation(false);
        activeTaskIdRef.current = undefined;
    }, [commitTaskClientState]);

    const switchTaskIdentity = useCallback((nextTaskId: string | null | undefined) => {
        if (nextTaskId === undefined || activeTaskIdRef.current === nextTaskId) return;
        resetTaskSnapshot();
        activeTaskIdRef.current = nextTaskId;
    }, [resetTaskSnapshot]);

    const prepareForNewTaskStream = useCallback(() => {
        const currentTask = taskClientStateRef.current.task;
        const currentSnapshot = taskSnapshotRef.current;
        if (isTerminalTaskState(currentTask?.state) || isTerminalTaskState(currentSnapshot?.state)) {
            resetTaskSnapshot();
        }
    }, [resetTaskSnapshot]);

    const acceptTaskSnapshotPart = useCallback((incoming: MobileAgentTaskSnapshot): boolean => {
        const current = taskSnapshotRef.current;
        const currentTaskId = activeTaskIdRef.current ?? current?.taskId ?? taskClientStateRef.current.task?.taskId;
        if (activeTaskIdRef.current === null) return false;
        if (currentTaskId && currentTaskId !== incoming.taskId) return false;
        if (current && incoming.revision < current.revision) return false;
        if (current
            && incoming.revision === current.revision
            && incoming.snapshotRef === current.snapshotRef
            && incoming.state === current.state) return false;
        taskSnapshotRef.current = incoming;
        setTaskSnapshot(incoming);
        return true;
    }, []);

    const beginTaskSnapshotRequest = useCallback(() => {
        const current = taskClientStateRef.current;
        if (current.requestGeneration === Number.MAX_SAFE_INTEGER) throw new Error("Task request generation exhausted");
        const next = { ...current, requestGeneration: current.requestGeneration + 1 };
        commitTaskClientState(next);
        return captureAgentTaskSnapshotRequest(next);
    }, [commitTaskClientState]);

    const markTaskEventPending = useCallback((eventId: string) => {
        const current = taskClientStateRef.current;
        if (current.pendingEventIds.includes(eventId)) return;
        commitTaskClientState({ ...current, pendingEventIds: [...current.pendingEventIds, eventId] });
    }, [commitTaskClientState]);

    const removeTaskEventPending = useCallback((eventId: string) => {
        const current = taskClientStateRef.current;
        const pendingEventIds = current.pendingEventIds.filter((candidate) => candidate !== eventId);
        if (pendingEventIds.length === current.pendingEventIds.length) return;
        commitTaskClientState({ ...current, pendingEventIds });
    }, [commitTaskClientState]);

    const acceptAuthorizedTask = useCallback((
        task: unknown,
        request: ReturnType<typeof captureAgentTaskSnapshotRequest>,
        acknowledgedEventId?: string,
        conflict = false,
    ) => {
        const parsedTask = AgentTaskSchema.safeParse(task);
        if (!parsedTask.success) return null;
        const current = taskClientStateRef.current;
        const currentTaskId = activeTaskIdRef.current ?? taskSnapshotRef.current?.taskId ?? current.task?.taskId;
        if (activeTaskIdRef.current === null) return null;
        if (currentTaskId && currentTaskId !== parsedTask.data.taskId) return null;
        if (taskSnapshotRef.current && parsedTask.data.revision < taskSnapshotRef.current.revision) return null;
        const envelope = AgentTaskSnapshotEnvelopeSchema.safeParse({
            identityEpoch: request.identityEpoch,
            task: parsedTask.data,
            ...(acknowledgedEventId ? { acknowledgedEventId } : {}),
            ...(conflict ? { conflict: { status: 409, latestRevision: parsedTask.data.revision, latestSnapshotRef: parsedTask.data.currentSnapshotRef } } : {}),
        });
        if (!envelope.success) return null;
        const acceptance = acceptAgentTaskSnapshot(current, envelope.data, request);
        if (acceptance.accepted) {
            commitTaskClientState(acceptance.state);
            acceptTaskSnapshotPart(taskSnapshotPartFromTask(parsedTask.data));
            setTaskNeedsReconciliation(acceptance.needsReconciliation || conflict);
        }
        return acceptance;
    }, [acceptTaskSnapshotPart, commitTaskClientState]);

    const refreshTask = useCallback(async (taskId?: string): Promise<boolean> => {
        const current = taskClientStateRef.current;
        const id = taskId ?? taskSnapshotRef.current?.taskId ?? current.task?.taskId;
        if (!id) return false;
        if (activeTaskIdRef.current === undefined) activeTaskIdRef.current = id;
        if (activeTaskIdRef.current !== id) return false;
        let request: ReturnType<typeof captureAgentTaskSnapshotRequest>;
        try {
            request = beginTaskSnapshotRequest();
        } catch {
            return false;
        }
        try {
            const response = await authenticatedFetch(`/api/ai/agent/tasks/${encodeURIComponent(id)}`, { credentials: "same-origin" });
            const body = await response.json().catch(() => undefined) as unknown;
            if (response.status === 409) {
                const snapshot = body && typeof body === "object" ? (body as Record<string, unknown>).snapshot : undefined;
                const accepted = snapshot ? acceptAuthorizedTask(snapshot, request, undefined, true) : null;
                setTaskNeedsReconciliation(true);
                setErrorState({ code: "task_conflict", message: "초안이 다른 화면에서 변경되었습니다. 최신 내용을 확인해 주세요.", effectState: "nothing-happened" });
                return Boolean(accepted?.accepted);
            }
            if (!response.ok) {
                if (response.status === 410) {
                    setErrorState({ code: "task_expired", message: "초안이 만료되었습니다. 새 업무를 시작해 주세요.", effectState: "nothing-happened" });
                }
                return false;
            }
            const authoritative = acceptAuthorizedTask(body, request);
            const accepted = Boolean(authoritative?.accepted || authoritative?.reason === "same-revision" || authoritative?.reason === "acknowledged-event");
            if (accepted) {
                setTaskNeedsReconciliation(false);
                setErrorState((currentError) => currentError?.code === "task_conflict" ? null : currentError);
            }
            return accepted;
        } catch {
            return false;
        }
    }, [acceptAuthorizedTask, beginTaskSnapshotRequest]);

    const handleTaskConflict = useCallback((body: unknown, request: ReturnType<typeof captureAgentTaskSnapshotRequest>) => {
        const snapshot = body && typeof body === "object" ? (body as Record<string, unknown>).snapshot : undefined;
        const accepted = snapshot ? acceptAuthorizedTask(snapshot, request, undefined, true) : null;
        setTaskNeedsReconciliation(true);
        setErrorState({ code: "task_conflict", message: "초안이 다른 화면에서 변경되었습니다. 최신 내용을 확인해 주세요.", effectState: "nothing-happened" });
        return accepted;
    }, [acceptAuthorizedTask]);

    const executeTaskMutation = useCallback(async (
        taskId: string,
        method: "PATCH" | "POST",
        path: string,
        body: unknown,
        clientEventId: string,
        allowTaskIdentityTransition = false,
    ): Promise<MobileAgentTaskMutationResult> => {
        let request: ReturnType<typeof captureAgentTaskSnapshotRequest>;
        try {
            request = beginTaskSnapshotRequest();
        } catch {
            return { status: "failed" };
        }
        markTaskEventPending(clientEventId);
        try {
            const response = await authenticatedFetch(path, {
                method,
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            const payload = await response.json().catch(() => undefined) as unknown;
            if (response.ok) {
                const parsed = AgentTaskMutationResponseSchema.safeParse(payload);
                if (!parsed.success) {
                    removeTaskEventPending(clientEventId);
                    setErrorState({ code: "task_response_invalid", message: "초안 변경 결과를 확인하지 못했습니다.", effectState: "nothing-happened" });
                    return { status: "failed" };
                }
                let acceptanceRequest = request;
                const currentRequest = captureAgentTaskSnapshotRequest(taskClientStateRef.current);
                const requestIsCurrent = request.identityEpoch === currentRequest.identityEpoch
                    && request.requestGeneration === currentRequest.requestGeneration;
                const currentTaskId = activeTaskIdRef.current ?? taskClientStateRef.current.task?.taskId;
                if (allowTaskIdentityTransition
                    && requestIsCurrent
                    && parsed.data.snapshot.taskId !== activeTaskIdRef.current
                    && (!currentTaskId || currentTaskId === taskId)) {
                    switchTaskIdentity(parsed.data.snapshot.taskId);
                    acceptanceRequest = captureAgentTaskSnapshotRequest(taskClientStateRef.current);
                }
                const accepted = acceptAuthorizedTask(parsed.data.snapshot, acceptanceRequest, parsed.data.receipt.eventId);
                if (!accepted?.accepted && accepted?.reason === "stale-generation") {
                    setTaskNeedsReconciliation(true);
                }
                return { status: "applied", task: parsed.data.snapshot, snapshot: taskSnapshotPartFromTask(parsed.data.snapshot) };
            }
            if (response.status === 409) {
                handleTaskConflict(payload, request);
                // A conflict leaves this event pending so the caller can decide
                // whether to retry after reviewing the latest server snapshot.
                return { status: "conflict" };
            }
            removeTaskEventPending(clientEventId);
            if (response.status === 410) {
                setErrorState({ code: "task_expired", message: "초안이 만료되었습니다. 새 업무를 시작해 주세요.", effectState: "nothing-happened" });
            } else {
                setErrorState({ code: "task_mutation_failed", message: "초안 변경을 완료하지 못했습니다.", effectState: "nothing-happened" });
            }
            return { status: "failed" };
        } catch {
            removeTaskEventPending(clientEventId);
            setErrorState({ code: "task_mutation_unconfirmed", message: "초안 변경 결과를 확인하지 못했습니다. 최신 초안을 확인해 주세요.", effectState: "succeeded-unconfirmed" });
            return { status: "failed" };
        }
    }, [acceptAuthorizedTask, beginTaskSnapshotRequest, handleTaskConflict, markTaskEventPending, removeTaskEventPending, switchTaskIdentity]);

    const patchTask = useCallback(async (
        taskId: string,
        operations: readonly ClientInputOperation[],
        options: { expectedRevision?: number; clientEventId?: string } = {},
    ): Promise<MobileAgentTaskMutationResult> => {
        const expectedRevision = options.expectedRevision ?? taskRevisionFor(taskId, taskClientStateRef.current, taskSnapshotRef.current);
        const clientEventId = options.clientEventId ?? makeTaskEventId();
        const parsed = AgentTaskPatchRequestSchema.safeParse({ clientEventId, expectedRevision, operations });
        if (!parsed.success) {
            setErrorState({ code: "task_input_invalid", message: "초안 변경 입력을 확인해 주세요.", effectState: "nothing-happened" });
            return { status: "failed" };
        }
        setErrorState(null);
        return executeTaskMutation(taskId, "PATCH", `/api/ai/agent/tasks/${encodeURIComponent(taskId)}`, parsed.data, clientEventId);
    }, [executeTaskMutation]);

    const commandTask = useCallback(async (
        taskId: string,
        command: MobileAgentTaskCommand,
        options: { expectedRevision?: number; clientEventId?: string } = {},
    ): Promise<MobileAgentTaskMutationResult> => {
        const expectedRevision = options.expectedRevision ?? taskRevisionFor(taskId, taskClientStateRef.current, taskSnapshotRef.current);
        const clientEventId = options.clientEventId ?? makeTaskEventId();
        const parsed = AgentTaskCommandRequestSchema.safeParse({ ...command, clientEventId, expectedRevision });
        if (!parsed.success) {
            setErrorState({ code: "task_command_invalid", message: "초안 명령을 확인해 주세요.", effectState: "nothing-happened" });
            return { status: "failed" };
        }
        setErrorState(null);
        return executeTaskMutation(
            taskId,
            "POST",
            `/api/ai/agent/tasks/${encodeURIComponent(taskId)}/commands`,
            parsed.data,
            clientEventId,
            parsed.data.command === "start-update",
        );
    }, [executeTaskMutation]);

    const ingestTaskParts = useCallback((nextMessages: readonly MobileAgentMessage[], activeTaskId: string | null | undefined) => {
        if (!activeTaskId) return;
        const snapshots: MobileAgentTaskSnapshot[] = [];
        for (const message of nextMessages) {
            for (const part of message.parts) {
                const candidate = part as unknown as { type?: string; data?: unknown };
                if (candidate.type === "data-task-snapshot") {
                    const parsed = AgentTaskSnapshotPartSchema.safeParse(candidate.data);
                    if (parsed.success && parsed.data.taskId === activeTaskId) {
                        snapshots.push(parsed.data);
                    }
                } else if (candidate.type === "data-task-patch") {
                    const parsed = AgentTaskPatchPartSchema.safeParse(candidate.data);
                    if (!parsed.success || parsed.data.taskId !== activeTaskId) continue;
                } else if (candidate.type === "data-entity-select") {
                    const parsed = AgentEntitySelectPartSchema.safeParse(candidate.data);
                    if (!parsed.success || parsed.data.taskId !== activeTaskId) continue;
                }
            }
        }
        const latest = snapshots
            .sort((left, right) => right.revision - left.revision)
            .at(0);
        if (latest) acceptTaskSnapshotPart(latest);
        void refreshTask(activeTaskId);
    }, [acceptTaskSnapshotPart, refreshTask]);

    const refreshSessions = useCallback(async () => {
        const response = await authenticatedFetch("/api/ai/agent/sessions", { credentials: "same-origin" });
        if (!response.ok) return;
        const value = await response.json() as unknown;
        setSessions(Array.isArray(value) ? value as MobileAgentSessionSummary[] : []);
    }, []);

    useEffect(() => { void refreshSessions(); }, [refreshSessions]);

    const sendMessage = useCallback(async (text: string) => {
        const content = text.trim();
        if (!content || status === "streaming") return;
        prepareForNewTaskStream();
        const userMessage = { id: makeId(), role: "user" as const, parts: [{ type: "text", text: content }] } as MobileAgentMessage;
        const nextMessages = [...messages, userMessage];
        setMessages(nextMessages);
        setErrorState(null);
        setStatus("streaming");
        pendingSessionId.current = undefined;
        const controller = new AbortController();
        const operationEpoch = ++operationEpochRef.current;
        abortRef.current = controller;
        try {
            const response = await authenticatedFetch("/api/ai/agent/chat", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, locale: "ko", messages: [userMessage] }), signal: controller.signal });
            if (!response.ok || !response.body) throw new Error("Agent request failed");
            if (controller.signal.aborted || operationEpoch !== operationEpochRef.current) return;
            sessionId.current = response.headers.get("x-agent-session-id") ?? sessionId.current;
            if (sessionId.current && typeof window !== "undefined") window.sessionStorage.setItem(AGENT_SESSION_KEY, sessionId.current);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let assistantMessageId: string | undefined;
            const parts: MobileAgentPart[] = [];
            const streamedTaskIds = new Set<string>();
            const streamIsCurrent = () => !controller.signal.aborted && operationEpoch === operationEpochRef.current;
            const publishAssistantSnapshot = () => {
                if (!streamIsCurrent()) return;
                const id = assistantMessageId ??= makeId();
                const snapshot = parts.map((part) => ({ ...part }));
                setMessages((current) => {
                    if (!streamIsCurrent()) return current;
                    const nextMessage = { id, role: "assistant" as const, parts: snapshot } as MobileAgentMessage;
                    const existingIndex = current.findIndex((message) => message.id === id);
                    if (existingIndex < 0) return [...current, nextMessage];
                    const nextMessages = [...current];
                    nextMessages[existingIndex] = nextMessage;
                    return nextMessages;
                });
            };
            const consume = (line: string) => {
                if (!streamIsCurrent() || !line.startsWith("data:")) return;
                const raw = line.slice(5).trim();
                if (!raw || raw === "[DONE]") return;
                let changed = false;
                try {
                    const chunk = JSON.parse(raw) as { type?: string; delta?: string; data?: unknown; messageId?: unknown };
                    if (chunk.type === "start" && typeof chunk.messageId === "string" && chunk.messageId.length > 0) {
                        if (!assistantMessageId) {
                            assistantMessageId = chunk.messageId;
                            changed = true;
                        }
                    } else if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
                        const previous = parts.find((part) => part.type === "text");
                        if (previous) previous.text = `${previous.text ?? ""}${chunk.delta}`;
                        else parts.push({ type: "text", text: chunk.delta });
                        changed = true;
                    } else if (chunk.type === "data-task-snapshot") {
                        const parsed = AgentTaskSnapshotPartSchema.safeParse(chunk.data);
                        if (parsed.success) {
                            if (activeTaskIdRef.current === null || activeTaskIdRef.current === undefined) {
                                switchTaskIdentity(parsed.data.taskId);
                            }
                            if (acceptTaskSnapshotPart(parsed.data)) {
                                streamedTaskIds.add(parsed.data.taskId);
                                parts.push({ type: chunk.type, data: parsed.data });
                                changed = true;
                            }
                        }
                    } else if (chunk.type === "data-entity-select") {
                        const parsed = AgentEntitySelectPartSchema.safeParse(chunk.data);
                        if (parsed.success && activeTaskIdRef.current === parsed.data.taskId) {
                            streamedTaskIds.add(parsed.data.taskId);
                            parts.push({ type: chunk.type, data: parsed.data });
                            changed = true;
                        }
                    } else if (chunk.type === "data-task-patch") {
                        const parsed = AgentTaskPatchPartSchema.safeParse(chunk.data);
                        if (parsed.success && activeTaskIdRef.current === parsed.data.taskId) {
                            streamedTaskIds.add(parsed.data.taskId);
                            parts.push({ type: chunk.type, data: parsed.data });
                            changed = true;
                        }
                    } else if (chunk.type?.startsWith("data-")) {
                        parts.push({ type: chunk.type, data: chunk.data });
                        changed = true;
                    }
                } catch {
                    if (raw.startsWith('"')) {
                        parts.push({ type: "text", text: raw.slice(1, -1) });
                        changed = true;
                    }
                }
                if (changed) publishAssistantSnapshot();
            };
            while (true) {
                const next = await reader.read();
                if (!streamIsCurrent()) return;
                buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                lines.forEach(consume);
                if (next.done) break;
            }
            if (buffer) consume(buffer);
            if (controller.signal.aborted || operationEpoch !== operationEpochRef.current) return;
            if (parts.length === 0) parts.push({ type: "text", text: "응답을 받지 못했습니다." });
            publishAssistantSnapshot();
            for (const taskId of streamedTaskIds) {
                if (!streamIsCurrent()) return;
                await refreshTask(taskId);
            }
            setStatus("ready");
            await refreshSessions();
        } catch (error) {
            if (operationEpoch !== operationEpochRef.current) return;
            if ((error as Error).name !== "AbortError") {
                setStatus("error");
                setErrorState({ code: "stream_failed", message: "응답 스트림이 중단되었습니다.", effectState: "nothing-happened" });
            }
            else setStatus("ready");
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [acceptTaskSnapshotPart, messages, prepareForNewTaskStream, refreshSessions, refreshTask, status, switchTaskIdentity]);

    const stop = useCallback(() => {
        operationEpochRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus("ready");
    }, []);
    const selectSession = useCallback(async (id: string) => {
        const operationEpoch = ++operationEpochRef.current;
        const isDifferentSession = sessionId.current !== id;
        if (isDifferentSession) resetTaskSnapshot();
        pendingSessionId.current = id;
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus("ready");
        try {
            const response = await authenticatedFetch(`/api/ai/agent/sessions/${encodeURIComponent(id)}`, { credentials: "same-origin" });
            if (operationEpoch !== operationEpochRef.current) return;
            if (!response.ok) {
                if (sessionId.current === id) sessionId.current = undefined;
                if (typeof window !== "undefined" && window.sessionStorage.getItem(AGENT_SESSION_KEY) === id) {
                    window.sessionStorage.removeItem(AGENT_SESSION_KEY);
                }
                setStatus("ready");
                return;
            }
            const session = await response.json() as MobileAgentSessionSummary;
            if (operationEpoch !== operationEpochRef.current) return;
            const restoreMetadata = parseTaskRestoreMetadata(session);
            const activeTaskId = restoreMetadata?.activeTaskId ?? null;
            switchTaskIdentity(activeTaskId);
            sessionId.current = session.id;
            if (typeof window !== "undefined") window.sessionStorage.setItem(AGENT_SESSION_KEY, session.id);
            const restoredMessages = session.messages ?? [];
            setMessages(restoredMessages);
            ingestTaskParts(restoredMessages, activeTaskId);
            setStatus("ready");
        } finally {
            if (pendingSessionId.current === id && operationEpoch === operationEpochRef.current) {
                pendingSessionId.current = undefined;
            }
        }
    }, [ingestTaskParts, resetTaskSnapshot, switchTaskIdentity]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const storedSessionId = window.sessionStorage.getItem(AGENT_SESSION_KEY);
        if (!storedSessionId) return;
        void selectSession(storedSessionId).catch(() => {
            sessionId.current = undefined;
            window.sessionStorage.removeItem(AGENT_SESSION_KEY);
        });
    }, [selectSession]);

    const refreshCurrentSession = useCallback(async () => {
        if (!sessionId.current) return;
        await selectSession(sessionId.current);
    }, [selectSession]);

    const resolveActionError = useCallback(async (actionId: string, fallbackMessage: string): Promise<MobileAgentError> => {
        await refreshCurrentSession().catch(() => undefined);
        try {
            const response = await authenticatedFetch(`/api/ai/agent/actions/${encodeURIComponent(actionId)}`, { credentials: "same-origin" });
            if (!response.ok) return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다.", effectState: "succeeded-unconfirmed" };
            const action = await response.json() as { status?: unknown; error?: unknown };
            return actionErrorFromStatus(action.status, readActionErrorCode(action.error), fallbackMessage);
        } catch {
            return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다.", effectState: "succeeded-unconfirmed" };
        }
    }, [refreshCurrentSession]);

    const approveAction = useCallback(async (actionId: string, expectedRevision: string, acknowledgementToken?: string) => {
        setErrorState(null);
        try {
            const response = await authenticatedFetch(`/api/ai/agent/actions/${encodeURIComponent(actionId)}/approve`, {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision, ...(acknowledgementToken ? { acknowledgementToken } : {}) }),
            });
            await refreshCurrentSession();
            if (!response.ok) setErrorState(await resolveActionError(actionId, "승인 작업을 완료하지 못했습니다."));
        } catch {
            setErrorState(await resolveActionError(actionId, "승인 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const rejectAction = useCallback(async (actionId: string) => {
        setErrorState(null);
        try {
            const response = await authenticatedFetch(`/api/ai/agent/actions/${encodeURIComponent(actionId)}/reject`, {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}",
            });
            await refreshCurrentSession();
            if (!response.ok) setErrorState(await resolveActionError(actionId, "거절 요청을 완료하지 못했습니다."));
        } catch {
            setErrorState(await resolveActionError(actionId, "거절 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const submitStructuredForm = useCallback(async (formId: string, values: Record<string, unknown>) => {
        if (status === "streaming") return;
        const userMessage = { id: makeId(), role: "user" as const, parts: [{ type: "data-form-submit", data: { formId, values } }] } as MobileAgentMessage;
        setMessages((current) => [...current, userMessage]);
        setStatus("streaming");
        pendingSessionId.current = undefined;
        const controller = new AbortController();
        const operationEpoch = ++operationEpochRef.current;
        abortRef.current = controller;
        try {
            const response = await authenticatedFetch("/api/ai/agent/chat", {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId: sessionId.current, locale: "ko", messages: [userMessage] }), signal: controller.signal,
            });
            if (!response.ok) throw new Error("Agent form submission failed");
            if (controller.signal.aborted || operationEpoch !== operationEpochRef.current) return;
            sessionId.current = response.headers.get("x-agent-session-id") ?? sessionId.current;
            await response.text();
            if (controller.signal.aborted || operationEpoch !== operationEpochRef.current) return;
            await refreshCurrentSession();
            await refreshSessions();
            setStatus("ready");
        } catch (error) {
            if (operationEpoch !== operationEpochRef.current) return;
            setStatus((error as Error).name === "AbortError" ? "ready" : "error");
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [refreshCurrentSession, refreshSessions, status]);

    const deleteSession = useCallback(async (id: string) => {
        const deletingActiveSession = sessionId.current === id;
        const deletingPendingSession = pendingSessionId.current === id;
        const invalidatesSessionOperation = deletingActiveSession || deletingPendingSession;
        const operationEpoch = invalidatesSessionOperation ? ++operationEpochRef.current : operationEpochRef.current;
        if (invalidatesSessionOperation) {
            abortRef.current?.abort();
            abortRef.current = null;
            setStatus("ready");
        }
        try {
            const response = await authenticatedFetch(`/api/ai/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
            if (!response.ok) return;
            if (deletingActiveSession && operationEpoch === operationEpochRef.current && sessionId.current === id) {
                sessionId.current = undefined;
                if (typeof window !== "undefined") window.sessionStorage.removeItem(AGENT_SESSION_KEY);
                setMessages([]);
                resetTaskSnapshot();
            }
            await refreshSessions();
        } finally {
            if (pendingSessionId.current === id && operationEpoch === operationEpochRef.current) {
                pendingSessionId.current = undefined;
            }
        }
    }, [refreshSessions, resetTaskSnapshot]);

    const submitFeedback = useCallback(async (messageId: string, type: "positive" | "negative", comment?: string) => {
        if (!sessionId.current) return;
        await authenticatedFetch("/api/ai/agent/feedback", {
            method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: sessionId.current, messageId, type, ...(comment ? { comment } : {}) }),
        });
    }, []);

    const resetBranch = useCallback(() => {
        operationEpochRef.current += 1;
        stop();
        pendingSessionId.current = undefined;
        sessionId.current = undefined;
        if (typeof window !== "undefined") window.sessionStorage.removeItem(AGENT_SESSION_KEY);
        setMessages([]);
        setStatus("ready");
        setErrorState(null);
        resetTaskSnapshot();
        void refreshSessions();
    }, [refreshSessions, resetTaskSnapshot, stop]);
    return {
        messages,
        status,
        errorState,
        sendMessage,
        stop,
        resetBranch,
        sessions,
        refreshSessions,
        selectSession,
        deleteSession,
        approveAction,
        rejectAction,
        submitStructuredForm,
        submitFeedback,
        taskSnapshot,
        task: taskClientState.task,
        taskNeedsReconciliation,
        refreshTask,
        patchTask,
        commandTask,
    };
}
