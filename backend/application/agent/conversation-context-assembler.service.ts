import { Injectable } from "@nestjs/common";

import {
    projectTaskForSafeChat,
    type AgentTask,
    type AgentTaskDisplayedChoiceHint,
    type AgentTaskSafeSnapshot,
    type AgentConversationMessage,
} from "@babyjamjam/shared";
import type { AgentSessionEntity } from "domain/entities/agent-session.entity";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { AgentTaskService } from "./agent-task.service";
import { redactFreeText, redactKnownValues } from "./agent-model-redaction";
import {
    conversationText,
    extractExplicitUserOperations,
    isQuestionLike,
    sanitizeConversationMessage,
} from "./conversation-task-policy";

export interface ConversationContextActionOutcome {
    capability: string;
    status: string;
    actionId?: string;
}

export interface ConversationContextInput {
    messages: readonly AgentConversationMessage[];
    summary?: unknown;
    tasks?: readonly AgentTask[];
    displayedChoice?: AgentTaskDisplayedChoiceHint;
    actionOutcomes?: readonly ConversationContextActionOutcome[];
    summarizedMessageCount?: number;
    protectedValues?: readonly unknown[];
}

export interface ConversationContext {
    history: readonly { id: string; role: "user" | "assistant"; text: string }[];
    taskInventory: readonly AgentTaskSafeSnapshot[];
    activeTask: AgentTaskSafeSnapshot | null;
    displayedChoice?: AgentTaskDisplayedChoiceHint;
    actionOutcomes: readonly ConversationContextActionOutcome[];
    summary: Record<string, unknown>;
    currentTurn: {
        text: string;
        isQuestion: boolean;
        explicitOperations: readonly unknown[];
    };
}

export function safeSummary(summary: unknown, protectedValues: readonly unknown[] = []): Record<string, unknown> {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
    const value = summary as Record<string, unknown>;
    const selectedEntities = value["selectedEntities"];
    const safeSelectedEntities = selectedEntities && typeof selectedEntities === "object" && !Array.isArray(selectedEntities)
        ? Object.fromEntries(Object.entries(selectedEntities as Record<string, unknown>).map(([domain, entry]) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [domain, { present: true }];
            const item = entry as Record<string, unknown>;
            // Entity names and labels are lookup values. Preserve only a
            // structural presence marker in the model context; task refs are
            // supplied by the live safe snapshot instead.
            return [domain, {
                present: true,
                ...(typeof item["status"] === "string" ? { status: item["status"] } : {}),
            }];
        }))
        : undefined;
    return {
        ...(typeof value["version"] === "string" ? { version: value["version"] } : {}),
        ...(typeof value["sourceMessageCount"] === "number" ? { sourceMessageCount: value["sourceMessageCount"] } : {}),
        ...(Array.isArray(value["goals"])
            ? {
                goals: value["goals"]
                    .filter((item): item is string => typeof item === "string")
                    .map((goal) => redactKnownValues(redactFreeText(goal), protectedValues))
                    .slice(-5),
            }
            : {}),
        ...(safeSelectedEntities ? { selectedEntities: safeSelectedEntities } : {}),
    };
}

function safeHistory(messages: readonly AgentConversationMessage[], summarizedMessageCount = 0, protectedValues: readonly unknown[] = []) {
    return messages
        .slice(Math.max(0, Math.min(summarizedMessageCount, messages.length)))
        .filter((message): message is AgentConversationMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
        .map((message) => {
            const sanitized = sanitizeConversationMessage({
                ...(message as unknown as { id: string; role: "user" | "assistant"; parts: readonly unknown[]; displayedChoice?: AgentTaskDisplayedChoiceHint }),
                protectedValues,
            });
            return {
                id: sanitized.id,
                role: message.role,
                text: redactFreeText(conversationText(sanitized)).slice(0, 2_000),
            };
        })
        .filter((message) => message.text.length > 0)
        .slice(-20);
}

function safeTasks(tasks: readonly AgentTask[]): AgentTaskSafeSnapshot[] {
    return tasks.map((task) => projectTaskForSafeChat(task));
}

/** Keep the operation shape for routing continuity without copying values. */
function safeExplicitOperations(text: string): readonly Record<string, unknown>[] {
    return extractExplicitUserOperations(text).map((operation) => ({
        op: operation.op,
        field: operation.field,
    }));
}

function latestActiveTask(tasks: readonly AgentTaskSafeSnapshot[]): AgentTaskSafeSnapshot | null {
    const active = tasks.filter((task) => ["collecting", "confirming_target", "review_ready"].includes(task.state));
    return active.sort((left, right) => right.revision - left.revision || left.taskId.localeCompare(right.taskId))[0] ?? null;
}

/**
 * Build one model-safe context object. Live task state is supplied separately
 * from the historical summary, so a stale summary cannot overwrite current
 * revisions, constraints or tentative status.
 */
export function assembleConversationContext(input: ConversationContextInput): ConversationContext {
    const latest = input.messages.at(-1);
    const latestText = latest ? conversationText(latest) : "";
    const latestSafe = latest
        ? sanitizeConversationMessage({
            ...(latest as unknown as { id: string; role: "user" | "assistant" | "system"; parts: readonly unknown[]; displayedChoice?: AgentTaskDisplayedChoiceHint }),
            protectedValues: input.protectedValues,
        })
        : undefined;
    const tasks = safeTasks(input.tasks ?? []);
    const activeTask = latestActiveTask(tasks);
    const hint = input.displayedChoice;
    const displayedChoice = hint && activeTask
        && hint.taskId === activeTask.taskId
        && hint.revision === activeTask.revision
        && activeTask.choiceSets.some((set) => set.choiceSetRef === hint.choiceSetRef)
        ? hint
        : undefined;
    const summary = safeSummary(input.summary, input.protectedValues);
    // The bounded digest is useful continuity, but current task state always
    // comes from the live inventory above. No protected task values enter this
    // context object.
    return {
        history: safeHistory(input.messages, input.summarizedMessageCount, input.protectedValues),
        taskInventory: tasks,
        activeTask,
        ...(displayedChoice ? { displayedChoice } : {}),
        actionOutcomes: (input.actionOutcomes ?? []).map((outcome) => ({
            capability: outcome.capability,
            status: outcome.status,
            ...(outcome.actionId ? { actionId: outcome.actionId } : {}),
        })),
        summary,
        currentTurn: {
            text: latestSafe ? redactFreeText(conversationText(latestSafe)) : "",
            isQuestion: latestSafe ? isQuestionLike(conversationText(latestSafe)) : false,
            explicitOperations: latest ? safeExplicitOperations(latestText) : [],
        },
    };
}

@Injectable()
export class ConversationContextAssemblerService {
    constructor(private readonly tasks: AgentTaskService) {}

    async assemble(
        principal: VerifiedTenantPrincipal,
        session: AgentSessionEntity,
        input: Omit<ConversationContextInput, "tasks" | "summary"> & { summary?: unknown },
    ): Promise<ConversationContext> {
        const tasks = await this.tasks.listForConversation(principal, session.id);
        return assembleConversationContext({
            ...input,
            tasks,
            summary: input.summary ?? session.summary,
        });
    }
}
