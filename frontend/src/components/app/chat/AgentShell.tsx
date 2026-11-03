"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Send, Sparkles, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ListPanel } from "@/components/app/v3/ListPanel";
import { ChatWorkspace } from "./ChatWorkspace";
import { ChatWorkspaceStats } from "./ChatWorkspaceStats";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentTask, AgentTaskPatchRequest } from "@babyjamjam/shared/agent";
import { AgentPartRegistry, hasRenderableAgentPart } from "./parts/AgentPartRegistry";
import { ErrorPart } from "./parts/ErrorPart";
import { TaskSnapshotControls } from "./parts/TaskSnapshotPart";
import { useAgentChat, type AgentTaskCommand } from "@/hooks/useAgentChat";

const REFRESHABLE_TASK_ERROR_CODES = new Set([
    "task_conflict",
    "task_conflict_unresolved",
    "task_reconciliation_required",
    "task_mutation_unconfirmed",
    "task_command_unconfirmed",
    "task_patch_failed",
    "task_patch_invalid",
    "task_command_failed",
    "task_command_invalid",
]);

export function AgentShellLoading() {
    return <section data-component="desktop_chat_agent-shell_loading" data-source-component="AgentShell" className="grid h-full min-h-0 place-items-center overflow-hidden" role="status" aria-live="polite">AI 운영 코파일럿 준비 중...</section>;
}

export function AgentShell() {
    const router = useRouter();
    const [input, setInput] = useState("");
    const [sessionSearch, setSessionSearch] = useState("");
    const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const { messages, sendMessage, status, error, actionError, taskError, taskSnapshotState, taskAccessState, taskMutationInFlight, taskNeedsReconciliation, createTaskEventId, patchTask, commandTask, loadTaskSnapshot, retryPendingTaskEvent, stop, regenerate, resetBranch, sessions, displayedSession, selectSession, renameSession, deleteSession, approveAction, rejectAction, submitStructuredForm, submitFeedback } = useAgentChat();
    const isStreaming = status === "streaming" || status === "submitted";
    const taskControlsBusy = isStreaming
        || taskMutationInFlight === true
        || taskNeedsReconciliation === true
        || taskAccessState?.status !== "authorized"
        || (taskSnapshotState?.pendingEventIds.length ?? 0) > 0;
    const canRefreshTask = taskAccessState?.status === "unavailable"
        || REFRESHABLE_TASK_ERROR_CODES.has(taskError?.code ?? "");
    const retryTaskId = canRefreshTask && typeof taskError?.taskId === "string" ? taskError.taskId : undefined;
    const retryPendingTask = taskError?.code === "task_pending_event"
        && typeof taskError.taskId === "string"
        && typeof taskError.pendingEventId === "string"
        ? { taskId: taskError.taskId, eventId: taskError.pendingEventId }
        : undefined;
    const taskMutationOptions = (task: AgentTask) => ({
        expectedRevision: task.revision,
        clientEventId: createTaskEventId?.() ?? "00000000-0000-4000-8000-000000000000",
    });
    const runTaskPatch = (taskId: string, operations: AgentTaskPatchRequest["operations"]) => {
        const task = taskSnapshotState?.task;
        if (!task || task.taskId !== taskId || taskControlsBusy) return;
        return patchTask(taskId, operations, taskMutationOptions(task));
    };
    const runTaskCommand = (taskId: string, command: AgentTaskCommand) => {
        const task = taskSnapshotState?.task;
        if (!task || task.taskId !== taskId || taskControlsBusy) return;
        return commandTask(taskId, command, taskMutationOptions(task));
    };
    const terminalActionIds = useMemo(() => new Set(messages.flatMap((message) => message.parts.flatMap((part) => {
        if (part.type !== "data-action-result") return [];
        const data = (part as { data?: { actionId?: unknown } }).data;
        return typeof data?.actionId === "string" ? [data.actionId] : [];
    }))), [messages]);
    const hasCurrentTaskSnapshot = useMemo(() => {
        const task = taskSnapshotState?.task;
        if (!task) return false;
        return messages.some((message) => message.parts.some((part) => {
            if (part.type !== "data-task-snapshot") return false;
            const data = (part as { data?: { taskId?: unknown; revision?: unknown; snapshotRef?: unknown } }).data;
            return data?.taskId === task.taskId
                && data.revision === task.revision
                && data.snapshotRef === task.currentSnapshotRef;
        }));
    }, [messages, taskSnapshotState?.task]);
    const filteredSessions = useMemo(() => {
        const query = sessionSearch.trim().toLocaleLowerCase();
        return query ? sessions.filter((session) => (session.title ?? "새 대화").toLocaleLowerCase().includes(query)) : sessions;
    }, [sessionSearch, sessions]);

    const submit = () => {
        const text = input.trim();
        if (!text || isStreaming) return;
        setInput("");
        void sendMessage({ text });
    };
    return (
        <ChatWorkspace data-component="desktop_chat_agent-shell" stats={<ChatWorkspaceStats data-component="desktop_chat_agent-shell_stats" />} list={(closeSidebarOnMobile) => (
            <ListPanel data-component="desktop_chat_agent-shell_sidebar" title="대화" headerActions={<div data-component="desktop_chat_agent-shell_sidebar_header"><Button type="button" variant="ghost" size="icon" aria-label="새 대화" onClick={() => { resetBranch(); closeSidebarOnMobile(); }}><Plus className="h-4 w-4" /></Button></div>} subHeader={<Input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} aria-label="대화 검색" placeholder="대화 검색" />}>
                <div data-component="desktop_chat_agent-shell_sidebar_sessions" className="flex flex-col gap-1 overflow-auto p-2">
                    {filteredSessions.map((session) => (
                        <div key={session.id} data-component="desktop_chat_agent-shell_sidebar_sessions_session" className="flex items-center gap-1">
                            {renamingSessionId === session.id
                                ? <Input autoFocus value={renameValue} aria-label="대화 제목" onChange={(event) => setRenameValue(event.target.value)} onBlur={() => setRenamingSessionId(null)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "Enter") { event.preventDefault(); void renameSession(session.id, renameValue).then((saved) => { if (saved) setRenamingSessionId(null); }); } if (event.key === "Escape") setRenamingSessionId(null); }} />
                                : <Button type="button" variant="ghost" size="sm" className={`min-w-0 flex-1 justify-start truncate ${displayedSession?.id === session.id ? "bg-v3-primary-light text-v3-primary" : ""}`} aria-current={displayedSession?.id === session.id ? "true" : undefined} onClick={() => { void selectSession(session.id); closeSidebarOnMobile(); }}>{session.title || "새 대화"}</Button>}
                            <Button type="button" variant="ghost" size="icon" aria-label={`${session.title || "대화"} 이름 변경`} onMouseDown={(event) => event.preventDefault()} onClick={() => { setRenameValue(session.title || "새 대화"); setRenamingSessionId(session.id); }}><Pencil className="h-4 w-4" /></Button>
                            <Button type="button" variant="ghost" size="icon" aria-label={`${session.title || "대화"} 삭제`} onClick={() => void deleteSession(session.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                    ))}
                </div>
            </ListPanel>
        )} header={(menu) => (
                <div data-component="desktop_chat_agent-shell_thread_header_controls" className="flex min-w-0 items-center gap-2 border-b border-v3-border pb-3">
                    {menu}
                    <Button type="button" variant="ghost" size="icon" aria-label="기존 채팅으로 돌아가기" onClick={() => window.history.back()}><ArrowLeft className="h-4 w-4" /></Button>
                    <h1 className="min-w-0 flex-1 truncate font-semibold">{displayedSession?.title || "새 대화"}</h1>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { resetBranch(); router.push("/select-branch"); }}>지점 바꾸기</Button>
                </div>
        )}>
                <ScrollArea className="min-h-0 flex-1"><div data-component="desktop_chat_agent-shell_thread_messages" className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
                    {messages.length === 0 && <div className="py-24 text-center text-muted-foreground"><p className="text-lg font-semibold">무엇을 도와드릴까요?</p><p className="mt-2 text-sm">고객·제공인력·일정·계약을 확인하고 권한이 있는 작업을 제안합니다.</p></div>}
                    {messages.filter((message) => message.role !== "assistant" || hasRenderableAgentPart(message.parts)).map((message) => <article key={message.id} data-component="desktop_chat_agent-shell_thread_messages_message" data-source-component="AgentShell" className={message.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-v3-primary-light px-4 py-3 text-v3-primary" : "w-full min-w-0"}><AgentPartRegistry data-component="desktop_chat_agent-shell_thread_messages_message_part-registry" message={message} task={taskSnapshotState?.task} isBusy={isStreaming} taskBusy={taskControlsBusy} terminalActionIds={terminalActionIds} onEntitySelect={(id, entityType) => void sendMessage({ text: `선택한 엔티티 유형: ${entityType}, 선택한 엔티티 ID: ${id}` })} onTaskEntitySelect={(taskId, choiceSetRef, optionId) => { void runTaskCommand(taskId, { command: "select-target", choiceSetRef, optionId }); }} onTaskPatch={runTaskPatch} onTaskCommand={runTaskCommand} onFeedback={(value) => void submitFeedback(message.id, value)} onApproveAction={(actionId, expectedRevision, acknowledgementToken) => void approveAction(actionId, expectedRevision, acknowledgementToken)} onRejectAction={(actionId) => void rejectAction(actionId)} onSubmitForm={submitStructuredForm} onRetry={() => void regenerate()} />{message.role === "assistant" && !message.parts.some((part) => part.type === "data-feedback") && <div data-component="desktop_chat_agent-shell_thread_messages_message_feedback" data-slot="feedback" className="mt-3 flex gap-2"><Button data-component="desktop_chat_agent-shell_thread_messages_message_feedback_positive" type="button" size="sm" variant="ghost" onClick={() => void submitFeedback(message.id, "positive")}>좋아요</Button><Button data-component="desktop_chat_agent-shell_thread_messages_message_feedback_negative" type="button" size="sm" variant="ghost" onClick={() => void submitFeedback(message.id, "negative")}>아쉬워요</Button></div>}</article>)}
                    {taskSnapshotState?.task && !hasCurrentTaskSnapshot && <TaskSnapshotControls data-component="desktop_chat_agent-shell_thread_task-controls" task={taskSnapshotState.task} disabled={taskControlsBusy} onPatch={runTaskPatch} onCommand={runTaskCommand} />}
                    {error && <ErrorPart data-component="desktop_chat_agent-shell_thread_messages_stream-error" code="stream_failed" category="client" message="응답 스트림이 중단되었습니다." retryable effectState="nothing-happened" onRetry={() => void regenerate()} />}
                    {actionError && <ErrorPart data-component="desktop_chat_agent-shell_thread_messages_action-error" code={actionError.code} category="client" message={actionError.message} retryable={false} effectState={actionError.effectState} />}
                    {taskError && <ErrorPart data-component="desktop_chat_agent-shell_thread_messages_task-error" code={taskError.code} category="persistence" message={taskError.message} retryable={retryTaskId !== undefined || (retryPendingTask !== undefined && retryPendingTaskEvent !== undefined)} effectState="nothing-happened" onRetry={retryPendingTask ? () => void retryPendingTaskEvent?.(retryPendingTask.taskId, retryPendingTask.eventId) : retryTaskId && loadTaskSnapshot ? () => void loadTaskSnapshot(retryTaskId) : undefined} />}
                </div></ScrollArea>
                <div data-component="desktop_chat_agent-shell_thread_composer" className="mx-auto w-full max-w-3xl shrink-0 p-4 sm:p-6">
                    <div data-component="desktop_chat_agent-shell_thread_composer_field" className="flex items-center gap-2 rounded-[28px] border border-v3-border p-2 pl-4">
                    <Sparkles className="h-5 w-5 shrink-0 text-primary" />
                    <Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="질문을 입력하세요" aria-label="질문 입력" rows={1} className="min-h-10 max-h-32 min-w-0 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" />
                    <Button type="button" size="icon" className="shrink-0 rounded-full" disabled={!isStreaming && !input.trim()} aria-label={isStreaming ? "중지" : "전송"} onClick={isStreaming ? () => void stop() : submit}>{isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}</Button>
                    </div>
                </div>
        </ChatWorkspace>
    );
}
