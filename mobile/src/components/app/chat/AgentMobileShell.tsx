"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, Send, Square, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { V3MobileHeader } from "@/components/app/v3/V3MobileHeader";
import { AGENT_DISCOVERY_ERROR_MESSAGE, useAgentCapabilities, useAgentChat } from "@/hooks/useAgentChat";
import { ChatPageLoading } from "./ChatPageLoading";
import { groupAgentSessions } from "./agent-session-groups";
import styles from "./AgentMobileShell.module.css";
import { MobileTaskControls } from "./MobileTaskControls";
import { MobileAgentPartRegistry, hasRenderableAgentPart } from "./MobileAgentPartRegistry";

export function AgentMobileShell() {
    const discovery = useAgentCapabilities();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [input, setInput] = useState("");
    const contentRef = useRef<HTMLDivElement>(null);
    const drawerRef = useRef<HTMLElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const { messages, status, errorState, sendMessage, stop, resetBranch, sessions, currentSessionId, selectSession, deleteSession, approveAction, rejectAction, submitStructuredForm, submitFeedback, task, taskNeedsReconciliation, taskMutationInFlight, taskPendingEventIds, refreshTask, patchTask, commandTask } = useAgentChat();
    const sessionGroups = groupAgentSessions(sessions);
    const agentReady = discovery === "enabled";
    const streaming = status === "streaming";
    const taskExpired = errorState?.code === "task_expired";
    const taskControlsBusy = streaming || Boolean(taskMutationInFlight) || (taskPendingEventIds?.length ?? 0) > 0 || taskNeedsReconciliation || taskExpired;
    const hasCurrentTaskSnapshot = useMemo(() => {
        if (!task) return false;
        return messages.some((message) => message.parts.some((part) => {
            if (part.type !== "data-task-snapshot") return false;
            const data = (part as { data?: { taskId?: unknown; revision?: unknown; snapshotRef?: unknown } }).data;
            return data?.taskId === task.taskId
                && data.revision === task.revision
                && data.snapshotRef === task.currentSnapshotRef;
        }));
    }, [messages, task]);
    const terminalActionIds = useMemo(() => new Set(messages.flatMap((message) => message.parts.flatMap((part) => {
        if (part.type !== "data-action-result") return [];
        const data = (part as { data?: { actionId?: unknown } }).data;
        return typeof data?.actionId === "string" ? [data.actionId] : [];
    }))), [messages]);
    const submit = () => { const value = input.trim(); if (!value || streaming || !agentReady) return; setInput(""); void sendMessage(value); };
    const onTaskPatch = useCallback((taskId: string, operations: Parameters<typeof patchTask>[1]) => {
        if (!task || task.taskId !== taskId || taskControlsBusy) return undefined;
        return patchTask(taskId, operations, { expectedRevision: task.revision });
    }, [patchTask, task, taskControlsBusy]);
    const onTaskCommand = useCallback((taskId: string, command: Parameters<typeof commandTask>[1]) => {
        if (!task || task.taskId !== taskId || taskControlsBusy) return undefined;
        return commandTask(taskId, command, { expectedRevision: task.revision });
    }, [commandTask, task, taskControlsBusy]);
    useEffect(() => {
        const content = contentRef.current;
        const drawer = drawerRef.current;
        if (content) content.inert = drawerOpen;
        if (drawer) drawer.inert = !drawerOpen;
        if (!drawerOpen) return;
        const nav = document.querySelector<HTMLElement>('[data-slot="mobile-bottom-nav"]');
        const previousNavInert = nav?.inert;
        if (nav) nav.inert = true;
        drawer?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setDrawerOpen(false);
                menuButtonRef.current?.focus();
            }
            if (event.key === "Tab") {
                const controls = [menuButtonRef.current, ...Array.from(drawer?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, textarea, [tabindex="0"]') ?? [])].filter((element): element is HTMLElement => Boolean(element));
                const index = controls.indexOf(document.activeElement as HTMLElement);
                const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length;
                event.preventDefault();
                controls[next]?.focus();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            if (nav) nav.inert = previousNavInert ?? false;
        };
    }, [drawerOpen]);
    const closeDrawer = () => {
        setDrawerOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    return <main data-component="mobile_chat_agent-shell" data-slot="agent-mobile-shell" className={styles.shell}>
        <V3MobileHeader data-component="mobile_chat_agent-shell_header" data-slot="agent-header" embedded notificationsDisabled={drawerOpen} className={styles.header} leadingSlot={
            <Button ref={menuButtonRef} data-component="mobile_chat_agent-shell_header_menu" data-slot="agent-header-menu" type="button" size="icon" variant="ghost" className={styles.headerIcon} aria-label="대화 목록" aria-controls="agent-mobile-session-drawer" aria-expanded={drawerOpen} onClick={() => drawerOpen ? closeDrawer() : setDrawerOpen(true)}><Menu aria-hidden="true" /></Button>
        } trailingSlot={
            <Button data-component="mobile_chat_agent-shell_header_new" data-slot="agent-header-new" type="button" variant="ghost" size="icon" className={styles.headerIcon} aria-label="새 대화" disabled={drawerOpen || !agentReady} onClick={resetBranch}><SquarePen aria-hidden="true" /></Button>
        } />
        <div ref={contentRef} data-slot="application-content" className="flex min-h-0 flex-1 flex-col">

            {discovery === "loading" ? <ChatPageLoading /> : discovery === "discovery-error" ? <section data-component="mobile_chat_agent-shell_discovery-error" role="alert" className="flex-1 p-4">{AGENT_DISCOVERY_ERROR_MESSAGE}</section> : <div data-component="mobile_chat_agent-shell_thread" className="min-h-0 flex-1 overflow-y-auto p-4 pb-6"><div className="flex min-w-0 flex-col gap-4">{messages.filter((message) => message.role !== "assistant" || hasRenderableAgentPart(message.parts)).map((message) => <article key={message.id} data-component={`mobile_chat_agent-shell_thread_message-${message.role}`} className={message.role === "user" ? "ml-8 rounded-2xl bg-primary p-3 text-primary-foreground" : "mr-8 rounded-2xl border bg-card p-3"}>{message.parts.map((part, index) => <MobileAgentPartRegistry key={`${message.id}-${index}`} data-component={`mobile_chat_agent-shell_thread_message-${message.role}_part-${index}${part.type === "data-action-proposal" ? "_action-approval" : ""}`} part={part as never} task={task} taskBusy={taskControlsBusy} taskNeedsReconciliation={taskNeedsReconciliation || taskExpired} onTaskPatch={onTaskPatch} onTaskCommand={onTaskCommand} terminalActionIds={terminalActionIds} onEntitySelect={(id, entityType) => void sendMessage(`선택한 엔티티 유형: ${entityType}, 선택한 엔티티 ID: ${id}`)} onTaskEntitySelect={(taskId, choiceSetRef, optionId) => { if (!task || task.taskId !== taskId || taskControlsBusy) return; void commandTask(taskId, { command: "select-target", choiceSetRef, optionId }, { expectedRevision: task.revision }); }} onApproveAction={(actionId, expectedRevision, acknowledgementToken) => void approveAction(actionId, expectedRevision, acknowledgementToken)} onRejectAction={(actionId) => void rejectAction(actionId)} onSubmitForm={(formId, values) => void submitStructuredForm(formId, values)} />)}{message.role === "assistant" && <div data-slot="feedback" className="mt-3 flex gap-2"><Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => void submitFeedback(message.id, "positive")}>좋아요</Button><Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => void submitFeedback(message.id, "negative")}>아쉬워요</Button></div>}</article>)}{task && !hasCurrentTaskSnapshot && <MobileTaskControls data-component="mobile_chat_agent-shell_thread_task-controls" task={task} taskBusy={taskControlsBusy} taskNeedsReconciliation={taskNeedsReconciliation || taskExpired} onPatch={onTaskPatch} onCommand={onTaskCommand} />}{taskNeedsReconciliation && <section data-component="mobile_chat_agent-shell_thread_task-conflict" data-slot="task-conflict" role="alert" className="rounded-xl border border-destructive/40 p-3"><p className="font-medium">{errorState?.code === "task_conflict" ? errorState.message : "초안이 다른 화면에서 변경되었습니다."}</p><p className="mt-1 text-xs text-muted-foreground">최신 초안을 확인한 뒤 다시 수정해 주세요.</p><Button type="button" variant="outline" className="mt-2 min-h-11" disabled={taskMutationInFlight} onClick={() => void refreshTask()}>최신 초안 불러오기</Button></section>}{errorState && !taskNeedsReconciliation && <section data-slot="client-error" role="alert" className="rounded-xl border border-destructive/40 p-3"><p className="font-medium">{errorState.message}</p><p className="mt-1 text-xs text-muted-foreground">{errorState.effectState === "nothing-happened" ? "작업은 실행되지 않았습니다." : errorState.effectState === "partial" ? "일부 단계만 완료되었을 수 있습니다. 다시 실행하지 마세요." : "결과 확인 전에는 다시 실행하지 마세요."}</p></section>}</div></div>}
            <div data-component="mobile_chat_agent-shell_composer" data-slot="agent-composer" className={styles.composer}><Textarea data-component="mobile_chat_agent-shell_composer_input" disabled={!agentReady} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} aria-label="질문 입력" placeholder="질문을 입력하세요" rows={1} /><Button type="button" size="icon" className="shrink-0" disabled={!agentReady || (!streaming && !input.trim())} aria-label={streaming ? "중지" : "전송"} onClick={streaming ? stop : submit}>{streaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}</Button></div>
        </div>
        <Button data-component="mobile_chat_agent-shell_scrim" data-slot="agent-session-scrim" type="button" variant="ghost" className={styles.scrim} data-open={drawerOpen} aria-label="대화 목록 닫기" aria-hidden={!drawerOpen} tabIndex={-1} onClick={closeDrawer} />
        <aside ref={drawerRef} id="agent-mobile-session-drawer" role="dialog" aria-modal={drawerOpen ? true : undefined} aria-hidden={!drawerOpen} aria-label="대화 목록" tabIndex={-1} data-component="mobile_chat_agent-shell_drawer" data-slot="agent-session-drawer" data-open={drawerOpen} className={styles.drawer}>
            <Button data-component="mobile_chat_agent-shell_drawer_new" data-slot="agent-session-new" type="button" className="h-10 w-full" disabled={!agentReady} onClick={() => { resetBranch(); closeDrawer(); }}><SquarePen className="h-4 w-4" aria-hidden="true" />새 대화</Button>
            {sessionGroups.map(({ label, sessions: groupedSessions }, groupIndex) => <section key={label} data-component={`mobile_chat_agent-shell_drawer_group-${groupIndex}`} aria-label={label}>
                <h2 data-slot="agent-session-group-label" className={styles.groupLabel}>{label}</h2>
                {groupedSessions.map((session) => <div key={session.id} data-component={`mobile_chat_agent-shell_drawer_group-${groupIndex}_session-${session.id}`} data-slot="agent-session-row" data-current={session.id === currentSessionId} className={styles.sessionRow}>
                    <Button data-component={`mobile_chat_agent-shell_drawer_group-${groupIndex}_session-${session.id}_select`} data-slot="agent-session-select" type="button" variant="ghost" className={styles.sessionSelect} disabled={!agentReady} aria-current={session.id === currentSessionId ? "true" : undefined} onClick={() => { void selectSession(session.id); closeDrawer(); }}>{session.title || "새 대화"}</Button>
                    <Button data-component={`mobile_chat_agent-shell_drawer_group-${groupIndex}_session-${session.id}_delete`} type="button" variant="ghost" size="icon" disabled={!agentReady} aria-label={`${session.title || "대화"} 삭제`} onClick={() => void deleteSession(session.id)}>×</Button>
                </div>)}
            </section>)}
        </aside>
    </main>;
}
