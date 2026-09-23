"use client";

import type { UIMessage } from "ai";
import type { Components } from "react-markdown";
import { Button } from "@/components/ui/button";
import { AgentActionApprovalCard } from "@/components/app/ui/AgentActionApprovalCard";
import { ChatMarkdown } from "../ChatMarkdown";
import { ActionResultPart } from "./ActionResultPart";
import { FormRequestPart } from "./FormRequestPart";
import { ErrorPart } from "./ErrorPart";
import { AttachmentPart } from "./AttachmentPart";
import {
    AgentActionProposalPartSchema,
    AgentActionResultPartSchema,
    AgentActivityPartSchema,
    AgentAttachmentPartSchema,
    AgentEntityChoicePartSchema,
    AgentErrorPartSchema,
    AgentFeedbackPartSchema,
    AgentFormPartSchema,
    AgentFormSubmitPartSchema,
    AgentNavigationPartSchema,
    AgentEntitySelectPartSchema,
    AgentTaskPatchPartSchema,
    AgentTaskSnapshotPartSchema,
    type AgentTaskPatchRequest,
    type AgentTask,
} from "@babyjamjam/shared";
import type { AgentTaskCommand } from "@/hooks/useAgentChat";
import { TaskEntitySelectPart, TaskPatchPart, TaskSnapshotPart } from "./TaskSnapshotPart";

type AgentPartRegistryProps = {
    "data-component": string;
    message: UIMessage;
    onEntitySelect?: (id: string, entityType: string) => void;
    task?: AgentTask | null;
    onTaskEntitySelect?: (taskId: string, choiceSetRef: string, optionId: string) => void;
    onTaskPatch?: (taskId: string, operations: AgentTaskPatchRequest["operations"]) => void | Promise<unknown>;
    onTaskCommand?: (taskId: string, command: AgentTaskCommand) => void | Promise<unknown>;
    onFeedback?: (value: "positive" | "negative") => void;
    onApproveAction?: (actionId: string, expectedRevision: string, acknowledgementToken?: string) => void;
    onRejectAction?: (actionId: string) => void;
    onSubmitForm?: (formId: string, values: Record<string, unknown>) => void;
    onRetry?: () => void;
    terminalActionIds?: ReadonlySet<string>;
    isBusy?: boolean;
    taskBusy?: boolean;
};

// Model-authored text can contain markdown links/images. Images are a
// zero-click exfiltration channel (a bare URL fetch fires on render), so we
// never render an <img> element — only its alt text. Links are restricted to
// http(s) (opened in a new tab) and same-origin absolute paths (same tab);
// anything else (javascript:, data:, mailto:, bare text that still parsed as
// a link, etc.) renders as plain text.
// Same-origin check on the exact href value react-markdown renders (after its
// urlTransform), resolved the way a browser would: "//host", "/\\host" and
// similar forms resolve to another origin and are rejected.
const SAME_ORIGIN_SENTINEL = "https://same-origin.invalid";
function isSameOriginPath(href: string): boolean {
    if (!href.startsWith("/")) return false;
    try {
        return new URL(href, SAME_ORIGIN_SENTINEL).origin === SAME_ORIGIN_SENTINEL;
    } catch {
        return false;
    }
}
const AGENT_TEXT_MARKDOWN_COMPONENTS: Components = {
    img: ({ alt }) => <>{alt ?? ""}</>,
    a: ({ href, children, ...props }) => {
        if (typeof href === "string" && /^https?:\/\//i.test(href)) {
            return (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                    {children}
                </a>
            );
        }
        if (typeof href === "string" && isSameOriginPath(href)) {
            return (
                <a href={href} {...props}>
                    {children}
                </a>
            );
        }
        return <>{children}</>;
    },
};

export function AgentPartRegistry({ "data-component": dataComponent, message, task, onTaskEntitySelect, onTaskPatch, onTaskCommand, onEntitySelect, onFeedback, onApproveAction, onRejectAction, onSubmitForm, onRetry, terminalActionIds, isBusy = false, taskBusy = false }: AgentPartRegistryProps) {
    const component = (suffix: string) => `${dataComponent}_${suffix}`;

    return (
        <div data-component={dataComponent} data-source-component="AgentPartRegistry" className="flex flex-col gap-3">
            {message.parts.map((part, index) => {
                // step-start marks the beginning of each model step (one per
                // tool call round-trip) and carries nothing worth showing;
                // reasoning is server-suppressed but must never leak into the
                // UI if it arrives anyway. Both render nothing, not the
                // "can't display this" fallback.
                if (part.type === "step-start" || part.type === "reasoning") return null;
                if (part.type === "text") {
                    return (
                        <div key={index} data-component={component("text")} data-slot="text" className="markdown-content break-words">
                            <ChatMarkdown components={AGENT_TEXT_MARKDOWN_COMPONENTS}>{part.text}</ChatMarkdown>
                        </div>
                    );
                }
                const toolPart = part as unknown as { type?: string; state?: string; output?: unknown; errorText?: string; toolName?: string };
                if (toolPart.type === "dynamic-tool" || toolPart.type?.startsWith("tool-")) {
                    const toolName = toolPart.toolName ?? toolPart.type?.slice(5).replaceAll("_", ".") ?? "agent";
                    if (toolPart.state === "output-error") {
                        return <p key={index} data-component={component("tool-error")} data-slot="tool-error" className="text-sm text-muted-foreground">{toolPart.errorText ?? "도구 결과를 표시할 수 없어요."}</p>;
                    }
                    if (toolPart.state === "output-available") {
                        const serialized = JSON.stringify(toolPart.output, null, 2);
                        return <details key={index} data-component={component("tool-result")} data-slot="tool-result" className="rounded-lg border p-3"><summary data-component={component("tool-result_summary")} className="cursor-pointer text-sm font-medium">{toolName} 결과</summary><pre data-component={component("tool-result_output")} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{serialized?.slice(0, 4000) ?? "결과 없음"}</pre></details>;
                    }
                    return <p key={index} data-component={component("tool-progress")} data-slot="tool-progress" className="text-sm text-muted-foreground">{toolName} 처리 중…</p>;
                }
                const data = (part as { data?: unknown }).data;
                if (part.type === "data-activity") {
                    const parsed = AgentActivityPartSchema.safeParse(data);
                    return parsed.success ? <p key={index} data-component={component("activity")} data-slot="activity" className="text-sm text-muted-foreground">{parsed.data.label}</p> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-error") {
                    const parsed = AgentErrorPartSchema.safeParse(data);
                    return parsed.success ? <ErrorPart key={index} data-component={component("error")} {...parsed.data} onRetry={onRetry} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-navigation") {
                    const parsed = AgentNavigationPartSchema.safeParse(data);
                    return parsed.success ? <a key={index} data-component={component("navigation")} data-slot="navigation" href={parsed.data.href} className="underline">{parsed.data.label}</a> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-action-proposal") {
                    const parsed = AgentActionProposalPartSchema.safeParse(data);
                    return parsed.success ? <AgentActionApprovalCard key={index} data-component={component("action-approval")} {...parsed.data} terminal={terminalActionIds?.has(parsed.data.actionId)} onApprove={onApproveAction} onReject={onRejectAction} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-action-result") {
                    const parsed = AgentActionResultPartSchema.safeParse(data);
                    return parsed.success ? <ActionResultPart key={index} data-component={component("action-result")} {...parsed.data} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-form") {
                    const parsed = AgentFormPartSchema.safeParse(data);
                    return parsed.success ? <FormRequestPart key={index} data-component={component("form-request")} {...parsed.data} isBusy={isBusy} onSubmit={onSubmitForm} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-form-submit") {
                    return AgentFormSubmitPartSchema.safeParse(data).success ? <p key={index} data-component={component("form-submit")} data-slot="form-submit" className="text-sm text-muted-foreground">구조화된 입력을 제출했습니다.</p> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-attachment") {
                    const parsed = AgentAttachmentPartSchema.safeParse(data);
                    return parsed.success ? <AttachmentPart key={index} data-component={component("attachment-part")} {...parsed.data} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-entity-choice") {
                    const parsed = AgentEntityChoicePartSchema.safeParse(data);
                    return parsed.success ? <div key={index} data-component={component("entity-choice")} data-slot="entity-choice" className="flex flex-wrap gap-2" role="group" aria-label={parsed.data.prompt}>{parsed.data.choices.map((choice) => <Button key={choice.id} data-component={component("entity-choice_choice")} type="button" variant="outline" size="sm" onClick={() => onEntitySelect?.(choice.id, parsed.data.entityType)}>{choice.label}</Button>)}</div> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-task-snapshot") {
                    const parsed = AgentTaskSnapshotPartSchema.safeParse(data);
                    return parsed.success
                        ? <TaskSnapshotPart key={index} data-component={component("task-snapshot")} data={parsed.data} task={task} taskBusy={taskBusy} onPatch={onTaskPatch} onCommand={onTaskCommand} />
                        : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-entity-select") {
                    const parsed = AgentEntitySelectPartSchema.safeParse(data);
                    return parsed.success
                        ? <TaskEntitySelectPart
                            key={index}
                            data-component={component("entity-select")}
                            data={parsed.data}
                            task={task}
                            disabled={taskBusy || task?.taskId !== parsed.data.taskId}
                            onSelect={(optionId) => onTaskEntitySelect?.(parsed.data.taskId, parsed.data.choiceSetRef, optionId)}
                        />
                        : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-task-patch") {
                    const parsed = AgentTaskPatchPartSchema.safeParse(data);
                    return parsed.success
                        ? <TaskPatchPart key={index} data-component={component("task-patch")} data={parsed.data} />
                        : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-feedback") {
                    const parsed = AgentFeedbackPartSchema.safeParse(data);
                    return parsed.success ? <div key={index} data-component={component("feedback")} data-slot="feedback" className="flex items-center gap-2" role="group" aria-label="응답 평가"><span data-component={component("feedback_prompt")} className="text-sm text-muted-foreground">{parsed.data.prompt}</span><Button data-component={component("feedback_positive")} type="button" variant="ghost" size="sm" onClick={() => onFeedback?.("positive")}>좋아요</Button><Button data-component={component("feedback_negative")} type="button" variant="ghost" size="sm" onClick={() => onFeedback?.("negative")}>아쉬워요</Button></div> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                return <SafePartFallback key={index} data-component={component("fallback")} />;
            })}
        </div>
    );
}

function SafePartFallback({ "data-component": dataComponent }: { "data-component": string }) {
    return <p data-component={dataComponent} data-slot="fallback" className="text-sm text-muted-foreground">이 응답의 새 형식은 현재 화면에서 안전하게 표시할 수 없습니다.</p>;
}
