import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";

import {
    ClientInputOperationSchema,
    ClientModelTaskOperationsSchema,
    ClientWriteFieldSchema,
    type AgentTask,
    type AgentTaskDisplayedChoiceHint,
    type ClientInputOperation,
    type ClientModelTaskOperation,
    type ClientWriteField,
} from "@babyjamjam/shared";
import type { CapabilityDefinition } from "./capability.types";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import {
    AgentTaskService,
    type AgentTaskChoiceAttachmentInput,
    type AgentTaskMutationOrigin,
} from "./agent-task.service";
import { AgentTaskPolicyService } from "./agent-task-policy.service";
import {
    canonicalConversationMessage,
    conversationMessageEventId,
    conversationMessageHash,
    conversationText,
    extractExplicitUserOperations,
    isQuestionLike,
    displayedChoiceMatches,
    type ConversationCanonicalMessage,
} from "./conversation-task-policy";

export interface ConversationTaskTurnInput {
    principal: VerifiedTenantPrincipal;
    sessionId: string;
    message: {
        id: string;
        role: "user";
        parts: readonly unknown[];
        displayedChoice?: AgentTaskDisplayedChoiceHint;
    };
    capabilityId?: "clients.create" | "clients.update";
    formSubmission?: { formId: string; values: Record<string, unknown> };
}

export interface ConversationTaskTurnResult {
    canonical: ConversationCanonicalMessage;
    eventId: string;
    requestHash: string;
    text: string;
    isQuestion: boolean;
    task: AgentTask | null;
    mutated: boolean;
    replayed: boolean;
    operations: readonly ClientInputOperation[];
    refusal?: "feature-disabled" | "unsupported-input";
}

export interface ConversationUserCorrectionEvidence {
    operation: "clear" | "discard-change";
    field: ClientWriteField;
}

export interface ConversationModelMutationInput {
    principal: VerifiedTenantPrincipal;
    sessionId: string;
    capabilityId: "clients.create" | "clients.update";
    operations: unknown;
    expectedRevision?: number;
    taskId?: string;
    intakeEventId: string;
    /**
     * Per-field and per-operation evidence observed by trusted server intake.
     * A model operation cannot authorize a destructive operation on another
     * field (or with another destructive operation) merely because some other
     * operation was supplied in the turn.
     */
    userCorrectionEvidence?: readonly ConversationUserCorrectionEvidence[];
    /**
     * A pure-question turn may still expose task tools for read-only context,
     * but any attempted model write must be rejected before task resolution
     * or persistence.  Omitted means the normal mutation path is allowed.
     */
    allowMutation?: boolean;
}

function ordinalIndex(text: string): number | null {
    const arabic = /(?:^|\s)(\d{1,2})\s*(?:번|번째|위|\.)?(?:\s|$)/u.exec(text);
    if (arabic?.[1]) return Number(arabic[1]) - 1;
    const korean = text.match(/(?:첫|첫째|두|둘째|두번째|셋|셋째|세번째|넷|넷째|네번째)/u)?.[0];
    if (!korean) return null;
    if (korean.startsWith("첫")) return 0;
    if (korean.startsWith("두")) return 1;
    if (korean.startsWith("셋") || korean.startsWith("세")) return 2;
    return 3;
}

function formOperations(form: ConversationTaskTurnInput["formSubmission"]): ClientInputOperation[] {
    if (!form) return [];
    const operations: ClientInputOperation[] = [];
    for (const [field, value] of Object.entries(form.values)) {
        if (field === "id" || field === "targetVersion") continue;
        if (!ClientWriteFieldSchema.safeParse(field).success && !["noSend", "automationChoice"].includes(field)) continue;
        const parsed = ClientInputOperationSchema.safeParse({ op: "set", field, value });
        if (parsed.success) operations.push(parsed.data as ClientInputOperation);
    }
    return operations;
}

function submittedFormCapability(form: ConversationTaskTurnInput["formSubmission"], sessionId: string): string | undefined {
    if (!form) return undefined;
    const suffix = `-${sessionId}`;
    return form.formId.endsWith(suffix) ? form.formId.slice(0, -suffix.length) : undefined;
}

function activeTask(tasks: readonly AgentTask[]): AgentTask | null {
    return tasks
        .filter((task) => ["collecting", "confirming_target", "review_ready"].includes(task.state))
        .sort((left, right) => right.revision - left.revision || left.taskId.localeCompare(right.taskId))[0] ?? null;
}

function safeTaskInput(input: ConversationTaskTurnInput): ConversationCanonicalMessage {
    const text = conversationText(input.message);
    return canonicalConversationMessage({
        userId: input.principal.userId,
        branchId: input.principal.branchId,
        sessionId: input.sessionId,
        messageId: input.message.id,
        text,
        ...(input.formSubmission ? { form: input.formSubmission } : {}),
        ...(input.message.displayedChoice ? { displayedChoice: input.message.displayedChoice } : {}),
    });
}

@Injectable()
export class ConversationTaskOrchestratorService {
    constructor(
        private readonly tasks: AgentTaskService,
        private readonly policy: AgentTaskPolicyService,
    ) {}

    async taskModeEnabled(
        principal: VerifiedTenantPrincipal,
        capabilityId: "clients.create" | "clients.update",
    ): Promise<boolean> {
        try {
            await this.policy.assertCanCreate(principal, capabilityId);
            return true;
        } catch {
            return false;
        }
    }

    async protectedValuesForConversation(
        principal: VerifiedTenantPrincipal,
        sessionId: string,
    ): Promise<string[]> {
        const reader = (this.tasks as AgentTaskService & {
            protectedValuesForConversation?: AgentTaskService["protectedValuesForConversation"];
        }).protectedValuesForConversation;
        return reader ? reader.call(this.tasks, principal, sessionId) : [];
    }

    async filterWriteCapabilities(
        principal: VerifiedTenantPrincipal,
        capabilities: readonly CapabilityDefinition[],
    ): Promise<{ capabilities: CapabilityDefinition[]; taskMode: boolean }> {
        let taskMode = false;
        const filtered: CapabilityDefinition[] = [];
        for (const capability of capabilities) {
            const isClientTaskCapability = capability.meta.name === "clients.create" || capability.meta.name === "clients.update";
            if (isClientTaskCapability && capability.meta.risk !== "read") {
                const enabled = await this.taskModeEnabled(principal, capability.meta.name as "clients.create" | "clients.update");
                if (enabled) {
                    taskMode = true;
                    continue;
                }
            }
            filtered.push(capability);
        }
        return { capabilities: filtered, taskMode };
    }

    async handleUserTurn(input: ConversationTaskTurnInput): Promise<ConversationTaskTurnResult> {
        const canonical = safeTaskInput(input);
        const eventId = conversationMessageEventId({
            userId: input.principal.userId,
            branchId: input.principal.branchId,
            sessionId: input.sessionId,
            messageId: input.message.id,
        });
        const requestHash = conversationMessageHash({
            userId: input.principal.userId,
            branchId: input.principal.branchId,
            sessionId: input.sessionId,
            messageId: input.message.id,
            text: conversationText(input.message),
            ...(input.formSubmission ? { form: input.formSubmission } : {}),
            ...(input.message.displayedChoice ? { displayedChoice: input.message.displayedChoice } : {}),
        });
        const replay = await this.tasks.replayConversationIntake(input.principal, input.sessionId, eventId, requestHash);
        if (replay) {
            // A durable task receipt may outlive a feature rollout. Respect the
            // current capability gate before exposing that historical task to a
            // legacy (feature-off) runtime; the immutable event remains intact.
            if (!await this.taskModeEnabled(input.principal, replay.snapshot.capabilityId)) {
                return {
                    canonical,
                    eventId,
                    requestHash,
                    text: conversationText(input.message),
                    isQuestion: isQuestionLike(conversationText(input.message)),
                    task: null,
                    mutated: false,
                    replayed: true,
                    operations: [],
                    refusal: "feature-disabled",
                };
            }
            return {
                canonical,
                eventId,
                requestHash,
                text: conversationText(input.message),
                isQuestion: isQuestionLike(conversationText(input.message)),
                task: replay.snapshot,
                mutated: false,
                replayed: true,
                operations: [],
            };
        }

        const text = conversationText(input.message);
        const submittedCapability = submittedFormCapability(input.formSubmission, input.sessionId);
        // Structured forms outside the client task contract stay on the
        // runtime's legacy proposal path.  They must never be interpreted as
        // client task operations, even when their values happen to use the
        // same field names.
        if (input.formSubmission && submittedCapability !== "clients.create" && submittedCapability !== "clients.update") {
            return {
                canonical,
                eventId,
                requestHash,
                text,
                isQuestion: isQuestionLike(text),
                task: null,
                mutated: false,
                replayed: false,
                operations: [],
                refusal: "unsupported-input",
            };
        }
        const operations = [
            ...formOperations(input.formSubmission),
            ...extractExplicitUserOperations(text),
        ];
        const tasks = await this.tasks.listForConversation(input.principal, input.sessionId);
        const current = activeTask(tasks);
        // A form id binds only a capability and session.  Without a task id
        // and expected revision it cannot safely target whichever task is now
        // active.  Exact replay was handled above, so refuse every new form
        // while preserving the current task snapshot for bounded UI state.
        if (input.formSubmission && current) {
            return {
                canonical,
                eventId,
                requestHash,
                text,
                isQuestion: isQuestionLike(text),
                task: current,
                mutated: false,
                replayed: false,
                operations: [],
                refusal: "unsupported-input",
            };
        }
        // A live task owns the continuation capability. Router output can
        // contain a different client write capability after compaction or a
        // follow-up question, but it must not retarget the existing task.
        const capabilityId = current?.capabilityId ?? input.capabilityId;

        if (operations.length === 0) {
            const index = ordinalIndex(text);
            if (current && input.message.displayedChoice && index !== null
                && displayedChoiceMatches(input.message.displayedChoice, {
                    taskId: current.taskId,
                    choiceSetRef: input.message.displayedChoice.choiceSetRef,
                    revision: current.revision,
                })) {
                if (!await this.taskModeEnabled(input.principal, current.capabilityId)) {
                    return {
                        canonical,
                        eventId,
                        requestHash,
                        text,
                        isQuestion: false,
                        task: current,
                        mutated: false,
                        replayed: false,
                        operations,
                        refusal: "feature-disabled",
                    };
                }
                const choiceSet = current.choiceSets.find((candidate) => candidate.choiceSetRef === input.message.displayedChoice!.choiceSetRef);
                const option = choiceSet?.options[index];
                if (option) {
                    const selected = await this.tasks.commandFromConversation(input.principal, current.taskId, {
                        clientEventId: eventId,
                        expectedRevision: current.revision,
                        command: "select-target",
                        choiceSetRef: input.message.displayedChoice.choiceSetRef,
                        optionId: option.optionId,
                    }, "user", requestHash);
                    return { canonical, eventId, requestHash, text, isQuestion: false, task: selected.snapshot, mutated: true, replayed: false, operations };
                }
            }
            if (!current) {
                return { canonical, eventId, requestHash, text, isQuestion: isQuestionLike(text), task: current, mutated: false, replayed: false, operations };
            }
            if (isQuestionLike(text)) {
                if (!await this.taskModeEnabled(input.principal, current.capabilityId)) {
                    return {
                        canonical,
                        eventId,
                        requestHash,
                        text,
                        isQuestion: true,
                        task: current,
                        mutated: false,
                        replayed: false,
                        operations,
                        refusal: "feature-disabled",
                    };
                }
                const recorded = await this.tasks.recordConversationIntake(input.principal, current.taskId, eventId, requestHash);
                return { canonical, eventId, requestHash, text, isQuestion: true, task: recorded.snapshot, mutated: false, replayed: false, operations };
            }
            if (!await this.taskModeEnabled(input.principal, current.capabilityId)) {
                return {
                    canonical,
                    eventId,
                    requestHash,
                    text,
                    isQuestion: false,
                    task: current,
                    mutated: false,
                    replayed: false,
                    operations,
                    refusal: "feature-disabled",
                };
            }
            const recorded = await this.tasks.recordConversationIntake(input.principal, current.taskId, eventId, requestHash);
            return { canonical, eventId, requestHash, text, isQuestion: isQuestionLike(text), task: recorded.snapshot, mutated: false, replayed: false, operations };
        }

        if (!capabilityId) {
            return {
                canonical,
                eventId,
                requestHash,
                text,
                isQuestion: isQuestionLike(text),
                task: current,
                mutated: false,
                replayed: false,
                operations,
                refusal: "unsupported-input",
            };
        }
        if (!await this.taskModeEnabled(input.principal, capabilityId)) {
            return { canonical, eventId, requestHash, text, isQuestion: isQuestionLike(text), task: current, mutated: false, replayed: false, operations, refusal: "feature-disabled" };
        }
        if (current && current.capabilityId !== capabilityId) {
            return { canonical, eventId, requestHash, text, isQuestion: isQuestionLike(text), task: current, mutated: false, replayed: false, operations, refusal: "unsupported-input" };
        }
        if (current) {
            const response = await this.tasks.patchFromConversation(input.principal, current.taskId, {
                clientEventId: eventId,
                expectedRevision: current.revision,
                operations,
            }, "user", requestHash);
            return { canonical, eventId, requestHash, text, isQuestion: isQuestionLike(text), task: response.snapshot, mutated: true, replayed: false, operations };
        }

        const response = await this.tasks.createFromConversation(input.principal, {
            sessionId: input.sessionId,
            capabilityId,
            clientEventId: eventId,
            operations,
        }, "user", requestHash);
        return { canonical, eventId, requestHash, text, isQuestion: isQuestionLike(text), task: response.snapshot, mutated: true, replayed: false, operations };
    }

    /** Parse and apply a model tool call after its independent finite schema check. */
    async applyModelMutation(input: ConversationModelMutationInput): Promise<{ task: AgentTask; mutated: boolean }> {
        if (input.allowMutation === false) throw new ConflictException("Question turn is read-only");
        const parsed = ClientModelTaskOperationsSchema.safeParse(input.operations);
        if (!parsed.success) throw new BadRequestException("Unsupported task operation");
        const resolved = await this.resolveModelOperations(input, parsed.data);
        const operations = resolved.operations;
        if (operations.length === 0) throw new BadRequestException("No task operation supplied");
        const resolvedTask = input.taskId
            ? await this.tasks.get(input.principal, input.taskId)
            : (await this.tasks.listForConversation(input.principal, input.sessionId))
                .find((task) => task.capabilityId === input.capabilityId && ["collecting", "confirming_target", "review_ready"].includes(task.state));
        const taskId = resolvedTask?.taskId;
        const requestHash = conversationMessageHash({
            userId: input.principal.userId,
            branchId: input.principal.branchId,
            sessionId: input.sessionId,
            messageId: input.intakeEventId,
            // Mutation provenance is part of the deterministic event payload.
            // Reusing one intake event with a different authority must be a
            // conflict instead of silently replaying a differently-authorized
            // mutation.
            text: JSON.stringify({ operations, origins: resolved.origins }),
        });
        const eventId = conversationMessageEventId({
            userId: input.principal.userId,
            branchId: input.principal.branchId,
            sessionId: input.sessionId,
            messageId: `${input.intakeEventId}:model:${input.expectedRevision ?? 0}`,
        });
        if (taskId) {
            const task = await this.tasks.patchFromConversation(input.principal, taskId, {
                clientEventId: eventId,
            expectedRevision: input.expectedRevision ?? resolvedTask?.revision ?? 0,
                operations,
            }, this.modelOrigin(), requestHash, resolved.origins);
            return { task: task.snapshot, mutated: true };
        }
        const task = await this.tasks.createFromConversation(input.principal, {
            sessionId: input.sessionId,
            capabilityId: input.capabilityId,
            clientEventId: eventId,
            operations,
        }, this.modelOrigin(), requestHash);
        return { task: task.snapshot, mutated: true };
    }

    async attachDerivedChoices(
        principal: VerifiedTenantPrincipal,
        taskId: string,
        producer: AgentTaskChoiceAttachmentInput["producer"],
        results: AgentTaskChoiceAttachmentInput["results"],
    ) {
        return this.tasks.attachChoices(principal, taskId, { expectedRevision: (await this.tasks.get(principal, taskId)).revision, producer, results });
    }

    private modelOrigin(): AgentTaskMutationOrigin {
        return "model";
    }

    private async resolveModelOperations(
        input: ConversationModelMutationInput,
        operations: readonly ClientModelTaskOperation[],
    ): Promise<{ operations: ClientInputOperation[]; origins: AgentTaskMutationOrigin[] }> {
        const task = input.taskId
            ? (await this.tasks.get(input.principal, input.taskId))
            : (await this.tasks.listForConversation(input.principal, input.sessionId)).find((candidate) => candidate.capabilityId === input.capabilityId && ["collecting", "confirming_target", "review_ready"].includes(candidate.state));
        if (!task && operations.some((operation) => "valueRef" in operation)) throw new ConflictException("Task reference is unavailable");
        const correctionEvidence = new Set((input.userCorrectionEvidence ?? []).map((evidence) => `${evidence.operation}:${evidence.field}`));
        const origins: AgentTaskMutationOrigin[] = [];
        const resolved = operations.map((operation) => {
            if (!("valueRef" in operation)) {
                if (operation.op === "clear" || operation.op === "discard-change") {
                    if (!correctionEvidence.has(`${operation.op}:${operation.field}`)) {
                        throw new ConflictException("Explicit user correction is required for this field");
                    }
                    origins.push("user");
                    return operation as ClientInputOperation;
                }
                origins.push("model");
                return operation as ClientInputOperation;
            }
            if (!task) throw new ConflictException("Task reference is unavailable");
            const candidates = [
                ["confirmed", task.provenance.confirmed[operation.field], task.confirmed[operation.field]],
                ["tentative", task.provenance.tentative[operation.field], task.tentative[operation.field]],
            ] as const;
            const match = candidates.find(([, provenance]) => provenance?.valueRef === operation.valueRef);
            if (!match || !match[1] || !["user", "wizard"].includes(match[1].source)) throw new ConflictException("Task reference is not owned by this turn");
            if (match[1].eventId !== input.intakeEventId) throw new ConflictException("Task reference is stale");
            // A current-turn tentative/wish value is still tentative.  A
            // valueRef only identifies the server-captured value; it does not
            // grant the model certainty to promote it into confirmed state.
            if (match[0] === "tentative" && operation.op === "set") {
                throw new ConflictException("Tentative task reference cannot be confirmed");
            }
            const value = match[2];
            if (value === undefined) throw new ConflictException("Task reference has no current value");
            origins.push("user");
            return { op: operation.op, field: operation.field, value } as ClientInputOperation;
        });
        return { operations: resolved, origins };
    }
}
