import {
    BadRequestException,
    ConflictException,
    GoneException,
    Inject,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import {
    AgentTaskCreateRequestSchema,
    AgentTaskIdSchema,
    AgentTaskPatchRequestSchema,
    applyClientInputOperations,
    createAgentTaskDefaults,
    evaluateClientReadiness,
    normalizeClientPhone,
    projectTaskForAuthorizedRest,
    type AgentTask,
    type AgentTaskCreateRequest,
    type AgentTaskEventReceipt,
    type AgentTaskPatchRequest,
    type ClientDuplicateCheckResult,
    type ClientInputOperation,
    type ClientInputState,
} from "@babyjamjam/shared";

import { AgentTaskPolicyService } from "application/agent/agent-task-policy.service";
import { assertPhoneAvailable } from "application/usecases/client/client-write-validation";
import {
    createEmptyAgentTaskDraft,
    toAgentTaskContract,
    type AgentTaskDraft,
    type AgentTaskEntity,
    type AgentTaskEventEntity,
    type AgentTaskOwner,
} from "domain/entities/agent-task.entity";
import {
    AGENT_TASK_REPOSITORY,
    type AgentTaskReadResult,
    type AgentTaskSessionScope,
    type AgentTaskMutationResult,
    type AgentTaskEventReceipt as DomainEventReceipt,
    type IAgentTaskRepository,
} from "domain/repositories/agent-task.repository.interface";
import { CLIENT_REPOSITORY, type IClientRepository } from "domain/repositories/client.repository.interface";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const REPLAY_RETENTION_MS = TASK_RETENTION_MS;
const DYNAMIC_ISSUE_CODES = new Set(["task.required", "task.invalid", "task.duplicate"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

export type AgentTaskConflictReason = "revision" | "event_payload" | "state" | "active_task" | "consent_required";

export interface AgentTaskConflictBody {
    code: "AGENT_TASK_CONFLICT";
    message: "Task input conflict";
    reason: AgentTaskConflictReason;
    snapshot?: AgentTask;
}

export class AgentTaskConflictException extends ConflictException {
    constructor(reason: AgentTaskConflictReason, snapshot?: AgentTask) {
        const body: AgentTaskConflictBody = {
            code: "AGENT_TASK_CONFLICT",
            message: "Task input conflict",
            reason,
            ...(snapshot ? { snapshot } : {}),
        };
        super(body);
    }
}

type TransactionStatus = "not_found" | "session_archived" | "session_expired" | "storage_failure";

type InternalMutation =
    | { status: "created" | "updated" | "event_replay"; task: AgentTaskEntity; receipt: AgentTaskEventEntity }
    | { status: "event_hash_conflict"; task?: AgentTaskEntity }
    | { status: "stale_revision"; currentTask: AgentTaskEntity }
    | { status: "state_conflict"; task: AgentTaskEntity; reason: "state" | "active_task" | "consent_required" }
    | { status: "not_found" | "session_archived" | "session_expired" | "task_expired" | "task_purged" | "storage_failure"; task?: AgentTaskEntity };

type CreateEventLookup =
    | { status: "new" }
    | { status: "event_replay"; task: AgentTaskEntity; event: AgentTaskEventEntity }
    | { status: "event_hash_conflict"; task?: AgentTaskEntity }
    | { status: TransactionStatus | "task_purged" };

function invalidTaskInput(): BadRequestException {
    return new BadRequestException({ code: "AGENT_TASK_INVALID", message: "Invalid task input" });
}

function storageUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({ code: "AGENT_TASK_STORAGE_UNAVAILABLE", message: "Task storage unavailable" });
}

function taskGone(): GoneException {
    return new GoneException({ code: "AGENT_TASK_GONE", message: "Task is no longer available" });
}

function taskOwner(principal: VerifiedTenantPrincipal): AgentTaskOwner {
    return { userId: principal.userId, branchId: principal.branchId };
}

function eventReceipt(event: AgentTaskEventEntity, task: AgentTaskEntity): AgentTaskEventReceipt {
    return {
        taskId: event.taskId,
        eventId: event.clientEventId,
        eventHash: event.requestHash,
        acceptedRevision: event.acceptedRevision,
        currentSnapshotRef: task.draft.currentSnapshotRef,
    };
}

function canonicalHash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asAuthorizedTask(entity: AgentTaskEntity): AgentTask {
    return projectTaskForAuthorizedRest(toAgentTaskContract(entity));
}

function isReplayWithinRetention(event: Pick<AgentTaskEventEntity | DomainEventReceipt, "acceptedAt">): boolean {
    return Date.now() - event.acceptedAt.getTime() <= REPLAY_RETENTION_MS;
}

@Injectable()
export class AgentTaskService {
    constructor(
        @Inject(AGENT_TASK_REPOSITORY) private readonly repository: IAgentTaskRepository,
        private readonly policy: AgentTaskPolicyService,
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
    ) {}

    async create(principal: VerifiedTenantPrincipal, rawInput: unknown): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask }> {
        const input = this.parseCreate(rawInput);
        await this.policy.assertCanCreate(principal, input.capabilityId);

        const scope = { ...taskOwner(principal), sessionId: input.sessionId };
        const requestHash = canonicalHash({
            operation: "create",
            sessionId: input.sessionId,
            capabilityId: input.capabilityId,
            operations: input.operations,
        });

        // Resolve an existing event before creating a candidate task UUID. A
        // retry therefore cannot consume a new task identity or query client
        // data before returning its durable receipt.
        const prior = await this.lookupCreateEvent(scope, input.clientEventId, requestHash);
        if (prior.status !== "new") return this.mapCreateLookup(prior);

        const now = new Date();
        const taskId = randomUUID();
        const snapshotRef = randomUUID();
        const draft = await this.createDraft(principal, input, snapshotRef);
        const result = await this.repository.createWithEvent(scope, {
            taskId,
            capabilityId: input.capabilityId,
            draft,
            status: input.capabilityId === "clients.update" ? "confirming_target" : "collecting",
            expiresAt: new Date(now.getTime() + TASK_RETENTION_MS),
        }, {
            clientEventId: input.clientEventId,
            operation: "create",
            requestHash,
            acceptedRevision: 1,
            acceptedAt: now,
        });

        return this.mapMutation(result);
    }

    async get(principal: VerifiedTenantPrincipal, taskId: string): Promise<AgentTask> {
        const parsedTaskId = AgentTaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) throw invalidTaskInput();
        const result = await this.repository.findOwned(parsedTaskId.data, taskOwner(principal));
        if (result.status === "found") return asAuthorizedTask(result.task);
        this.throwReadResult(result);
    }

    async patch(principal: VerifiedTenantPrincipal, taskId: string, rawInput: unknown): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask }> {
        const parsedTaskId = AgentTaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) throw invalidTaskInput();
        const input = this.parsePatch(rawInput);
        const owner = taskOwner(principal);
        const initial = await this.repository.findOwned(parsedTaskId.data, owner);
        if (initial.status !== "found" && initial.status !== "task_expired") this.throwReadResult(initial);
        this.policy.assertCanPatch(principal, initial.task.capabilityId);

        const scope = { ...owner, sessionId: initial.task.sessionId };
        const requestHash = canonicalHash({
            operation: "patch",
            taskId: parsedTaskId.data,
            sessionId: initial.task.sessionId,
            expectedRevision: input.expectedRevision,
            operations: input.operations,
        });

        const result = await this.runPatchTransaction(principal, scope, parsedTaskId.data, input, requestHash);
        return this.mapInternalMutation(result);
    }

    async restoreSession(principal: VerifiedTenantPrincipal, sessionId: string): Promise<{
        activeTaskId: string | null;
        pausedTaskIds: string[];
        taskRestoreStatus: "available" | "session_archived" | "session_expired";
    }> {
        const result = await this.repository.listOwned({ ...taskOwner(principal), sessionId });
        if (result.status === "not_found") throw new NotFoundException("Agent session not found");
        if (result.status === "storage_failure") throw storageUnavailable();
        if (result.status === "session_archived") return { activeTaskId: null, pausedTaskIds: [], taskRestoreStatus: "session_archived" };
        if (result.status === "session_expired") return { activeTaskId: null, pausedTaskIds: [], taskRestoreStatus: "session_expired" };

        const now = Date.now();
        const live = result.tasks.filter((task) => task.purgedAt === null && task.expiresAt.getTime() > now);
        const active = live.find((task) => task.activeSlot === 1 && !TERMINAL_STATES.has(task.status));
        const pausedTaskIds = live.filter((task) => task.status === "paused").map((task) => task.taskId);
        return {
            activeTaskId: active?.taskId ?? null,
            pausedTaskIds,
            taskRestoreStatus: "available",
        };
    }

    // Explicit aliases keep the service easy to consume from route tests and
    // future command controllers without changing the ownership boundary.
    createTask = this.create.bind(this);
    getTask = this.get.bind(this);
    patchTask = this.patch.bind(this);

    private parseCreate(rawInput: unknown): AgentTaskCreateRequest {
        try {
            return AgentTaskCreateRequestSchema.parse(rawInput);
        } catch {
            throw invalidTaskInput();
        }
    }

    private parsePatch(rawInput: unknown): AgentTaskPatchRequest {
        try {
            return AgentTaskPatchRequestSchema.parse(rawInput);
        } catch {
            throw invalidTaskInput();
        }
    }

    private async lookupCreateEvent(
        scope: AgentTaskSessionScope,
        clientEventId: string,
        requestHash: string,
    ): Promise<CreateEventLookup> {
        const result = await this.repository.withTransaction(scope, async (transaction): Promise<CreateEventLookup> => {
            const session = await transaction.lockSession();
            if (session.status !== "locked") return { status: session.status };
            const existing = await transaction.findEvent(clientEventId);
            if (existing.status === "storage_failure") return existing;
            if (existing.status === "not_found") return { status: "new" };
            if (existing.event.requestHash !== requestHash) {
                const current = await transaction.readTask(existing.event.taskId);
                return {
                    status: "event_hash_conflict",
                    ...(current.status === "found" || current.status === "task_expired" ? { task: current.task } : {}),
                };
            }
            const current = await transaction.readTask(existing.event.taskId);
            if (current.status === "found" || current.status === "task_expired") {
                return { status: "event_replay", task: current.task, event: existing.event };
            }
            return { status: current.status };
        });
        if (result.status === "ok" || result.status === "aborted") return result.value;
        if (result.status === "active_task_conflict") return { status: "storage_failure" };
        if (result.status === "event_hash_conflict") return { status: "event_hash_conflict" };
        return { status: "storage_failure" };
    }

    private mapCreateLookup(lookup: Exclude<CreateEventLookup, { status: "new" }>): never {
        if (lookup.status === "event_hash_conflict") {
            throw new AgentTaskConflictException(
                "event_payload",
                lookup.task ? asAuthorizedTask(lookup.task) : undefined,
            );
        }
        if (lookup.status === "event_replay") {
            if (!isReplayWithinRetention(lookup.event)) throw taskGone();
            return this.responseFromReceipt(eventReceipt(lookup.event, lookup.task), lookup.task) as never;
        }
        if (lookup.status === "not_found") throw new NotFoundException("Agent session not found");
        if (lookup.status === "session_archived" || lookup.status === "session_expired") throw taskGone();
        if (lookup.status === "task_purged") throw taskGone();
        throw storageUnavailable();
    }

    private async createDraft(
        principal: VerifiedTenantPrincipal,
        input: AgentTaskCreateRequest,
        snapshotRef: string,
    ): Promise<AgentTaskDraft> {
        const state = applyClientInputOperations(input.operations, {
            confirmed: input.capabilityId === "clients.create" ? createAgentTaskDefaults() : {},
            tentative: {},
            clearedFields: [],
            automationChoice: "unanswered",
            noSend: false,
        });
        const provenance = this.applyProvenance({ confirmed: {}, tentative: {} }, input.operations, input.clientEventId);
        const duplicateCheck = await this.duplicateCheck(principal, state, undefined);
        const issues = this.issues([], state, duplicateCheck);
        if (state.automationChoice === "yes") {
            throw new AgentTaskConflictException("consent_required");
        }
        const empty = createEmptyAgentTaskDraft(snapshotRef);
        return {
            ...empty,
            confirmed: state.confirmed,
            tentative: state.tentative,
            clearedFields: state.clearedFields,
            provenance,
            issues,
            constraints: { noSend: state.noSend },
            consent: { choice: state.automationChoice, binding: null },
        };
    }

    private async runPatchTransaction(
        principal: VerifiedTenantPrincipal,
        scope: AgentTaskSessionScope,
        taskId: string,
        input: AgentTaskPatchRequest,
        requestHash: string,
    ): Promise<InternalMutation> {
        const raw = await this.repository.withTransaction(scope, async (transaction): Promise<InternalMutation> => {
            const session = await transaction.lockSession();
            if (session.status !== "locked") return { status: session.status };

            const locked = await transaction.lockTask(taskId);
            if (locked.status === "not_found" || locked.status === "storage_failure") return locked;
            const existing = await transaction.findEvent(input.clientEventId);
            if (existing.status === "storage_failure") return existing;
            if (existing.status === "found") {
                if (existing.event.requestHash !== requestHash) {
                    const current = await transaction.readTask(existing.event.taskId);
                    return {
                        status: "event_hash_conflict",
                        ...(current.status === "found" || current.status === "task_expired" ? { task: current.task } : {}),
                    };
                }
                const current = await transaction.readTask(existing.event.taskId);
                if (current.status === "found" || current.status === "task_expired") {
                    return { status: "event_replay", task: current.task, receipt: existing.event };
                }
                return current.status === "task_purged"
                    ? { status: "task_purged" }
                    : { status: current.status };
            }

            if (locked.status === "task_expired" || locked.status === "task_purged") return locked;
            if (input.expectedRevision !== locked.task.revision) {
                return { status: "stale_revision", currentTask: locked.task };
            }
            if (locked.task.activeActionId !== null) {
                return { status: "state_conflict", reason: "active_task", task: locked.task };
            }
            if (!["collecting", "confirming_target", "review_ready"].includes(locked.task.status)) {
                return { status: "state_conflict", reason: "state", task: locked.task };
            }

            let next: { draft: AgentTaskDraft; status: AgentTaskEntity["status"] };
            try {
                next = await this.nextDraft(principal, locked.task, input.operations, input.clientEventId);
            } catch (error) {
                if (error instanceof AgentTaskConflictException) {
                    const response = error.getResponse();
                    const reason = typeof response === "object" && response !== null && "reason" in response
                        && response.reason === "consent_required"
                        ? "consent_required"
                        : "state";
                    return transaction.abort<InternalMutation>({ status: "state_conflict", reason, task: locked.task });
                }
                throw error;
            }
            const now = new Date();
            const changed = JSON.stringify(next.draft) !== JSON.stringify(locked.task.draft) || next.status !== locked.task.status;
            if (!changed) {
                const inserted = await transaction.insertEvent({
                    clientEventId: input.clientEventId,
                    operation: "patch",
                    requestHash,
                    acceptedRevision: locked.task.revision,
                    acceptedAt: now,
                });
                if (inserted.status !== "inserted") {
                    return transaction.abort<InternalMutation>(
                        inserted.status === "event_hash_conflict" ? { status: "event_hash_conflict" } : { status: "storage_failure" },
                    );
                }
                return { status: "updated", task: locked.task, receipt: inserted.event };
            }

            next.draft.currentSnapshotRef = randomUUID();

            const updated = await transaction.updateTask({
                expectedRevision: input.expectedRevision,
                draft: next.draft,
                status: next.status,
                acceptedAt: now,
                expiresAt: new Date(now.getTime() + TASK_RETENTION_MS),
            });
            if (updated.status !== "updated") {
                if (updated.status === "active_task_conflict") {
                    return { status: "state_conflict", reason: "active_task", task: locked.task };
                }
                if (updated.status === "stale_revision") return updated;
                if (updated.status === "task_expired") return updated;
                if (updated.status === "task_purged") return updated;
                if (updated.status === "not_found" || updated.status === "session_archived" || updated.status === "session_expired") {
                    return updated;
                }
                return { status: "storage_failure" };
            }
            const inserted = await transaction.insertEvent({
                clientEventId: input.clientEventId,
                operation: "patch",
                requestHash,
                acceptedRevision: updated.task.revision,
                acceptedAt: now,
            });
            if (inserted.status !== "inserted") {
                return transaction.abort<InternalMutation>(
                    inserted.status === "event_hash_conflict" ? { status: "event_hash_conflict" } : { status: "storage_failure" },
                );
            }
            return { status: "updated", task: updated.task, receipt: inserted.event };
        });

        if (raw.status === "ok" || raw.status === "aborted") return raw.value;
        if (raw.status === "active_task_conflict") return { status: "state_conflict", reason: "active_task", task: (await this.mustReadTask(taskId, scope)).task };
        return raw.status === "event_hash_conflict" ? { status: "event_hash_conflict" } : { status: "storage_failure" };
    }

    private async nextDraft(
        principal: VerifiedTenantPrincipal,
        task: AgentTaskEntity,
        operations: readonly ClientInputOperation[],
        clientEventId: string,
    ): Promise<{ draft: AgentTaskDraft; status: AgentTaskEntity["status"] }> {
        const state = applyClientInputOperations(operations, {
            confirmed: task.draft.confirmed,
            tentative: task.draft.tentative,
            clearedFields: task.draft.clearedFields,
            automationChoice: task.draft.consent.choice,
            noSend: task.draft.constraints.noSend,
        });
        if (operations.some((operation) => operation.op === "set" && operation.field === "automationChoice" && operation.value === "yes")) {
            throw new AgentTaskConflictException("consent_required", asAuthorizedTask(task));
        }

        const duplicateCheck = await this.duplicateCheck(principal, state, task.draft.server.references.target?.clientId);
        const provenance = this.applyProvenance(task.draft.provenance, operations, clientEventId);
        const issues = this.issues(task.draft.issues, state, duplicateCheck);
        const discardsPhone = operations.some((operation) => operation.op === "discard-change" && operation.field === "phone");
        const discardedPhoneChoiceSetRefs = discardsPhone
            ? new Set(Object.keys(task.draft.server.references.phoneCandidates))
            : new Set<string>();
        const choiceSets = task.draft.choiceSets.filter((choiceSet) => !discardedPhoneChoiceSetRefs.has(choiceSet.choiceSetRef));
        const orderedChoiceRefs = task.draft.orderedChoiceRefs.filter((choiceSetRef) => !discardedPhoneChoiceSetRefs.has(choiceSetRef));
        const choiceTargets = task.draft.server.references.choiceTargets.filter(
            (choiceTarget) => !discardedPhoneChoiceSetRefs.has(choiceTarget.choiceSetRef),
        );
        const status = task.status === "review_ready"
            ? await this.demotedStatus(principal, task)
            : task.status;
        const binding = state.automationChoice === task.draft.consent.choice && state.automationChoice === "yes"
            ? task.draft.consent.binding
            : null;
        const draft: AgentTaskDraft = {
            ...task.draft,
            confirmed: state.confirmed,
            tentative: state.tentative,
            clearedFields: state.clearedFields,
            provenance,
            issues,
            constraints: { noSend: state.noSend },
            consent: { choice: state.automationChoice, binding },
            currentSnapshotRef: task.draft.currentSnapshotRef,
            choiceSets,
            orderedChoiceRefs,
            server: {
                ...task.draft.server,
                references: {
                    ...task.draft.server.references,
                    choiceTargets,
                    phoneCandidates: discardsPhone ? {} : { ...task.draft.server.references.phoneCandidates },
                },
                actionExpectedRevision: undefined,
                actionProposalRevision: undefined,
            },
        };
        return { draft, status };
    }

    private async demotedStatus(principal: VerifiedTenantPrincipal, task: AgentTaskEntity): Promise<AgentTaskEntity["status"]> {
        const clientId = task.draft.server.references.target?.clientId;
        if (task.capabilityId !== "clients.update") return "collecting";
        if (clientId === undefined) return "confirming_target";
        const client = await this.clientRepository.findById(principal.branchId, clientId);
        return client ? "confirming_target" : "collecting";
    }

    private applyProvenance(
        initial: AgentTaskDraft["provenance"],
        operations: readonly ClientInputOperation[],
        eventId: string,
    ): AgentTaskDraft["provenance"] {
        const confirmed = { ...initial.confirmed };
        const tentative = { ...initial.tentative };
        const capturedAt = new Date().toISOString();
        for (const operation of operations) {
            if (operation.op === "set" && operation.field !== "automationChoice" && operation.field !== "noSend") {
                confirmed[operation.field] = { source: "user", capturedAt, eventId, valueRef: randomUUID() };
                delete tentative[operation.field];
            } else if (operation.op === "mark-tentative") {
                tentative[operation.field] = { source: "user", capturedAt, eventId, valueRef: randomUUID() };
            } else if (operation.op === "clear" && operation.field !== "automationChoice" && operation.field !== "noSend") {
                delete confirmed[operation.field];
                delete tentative[operation.field];
            } else if (operation.op === "discard-change") {
                delete confirmed[operation.field];
                delete tentative[operation.field];
            }
        }
        return { confirmed, tentative };
    }

    private async duplicateCheck(
        principal: VerifiedTenantPrincipal,
        state: ClientInputState,
        currentClientId: number | undefined,
    ): Promise<ClientDuplicateCheckResult> {
        const normalizedPhone = normalizeClientPhone(state.confirmed.phone);
        if (!normalizedPhone || !/^\d{11}$/.test(normalizedPhone)) return { status: "not_checked" };
        try {
            await assertPhoneAvailable(this.clientRepository, principal.branchId, normalizedPhone, currentClientId);
            return { status: "clear", checkedPhone: normalizedPhone };
        } catch (error) {
            if (error instanceof ConflictException) return { status: "duplicate", checkedPhone: normalizedPhone };
            if (error instanceof BadRequestException) return { status: "failed", checkedPhone: normalizedPhone };
            if (error instanceof ServiceUnavailableException) throw error;
            throw storageUnavailable();
        }
    }

    private issues(
        existing: AgentTaskEntity["draft"]["issues"],
        state: ClientInputState,
        duplicateCheck: ClientDuplicateCheckResult,
    ): AgentTaskEntity["draft"]["issues"] {
        const issues = existing.filter((issue) => !DYNAMIC_ISSUE_CODES.has(issue.code));
        const readiness = evaluateClientReadiness(state.confirmed, duplicateCheck);
        for (const issue of readiness.issues) {
            const field = issue === "name_required" ? "name" : issue.startsWith("phone") ? "phone" : undefined;
            const code = issue === "phone_duplicate" ? "task.duplicate" : issue === "phone_duplicate_check_failed" ? "task.invalid" : issue === "phone_duplicate_check_required" ? "task.invalid" : "task.required";
            if (issues.some((candidate) => candidate.code === code && candidate.field === field)) continue;
            issues.push({ code, ...(field ? { field } : {}), severity: "error", message: "Additional task information is required" });
        }
        return issues;
    }

    private responseFromReceipt(receipt: AgentTaskEventReceipt, task: AgentTaskEntity) {
        return { receipt, snapshot: asAuthorizedTask(task) };
    }

    private mapMutation(result: AgentTaskMutationResult): never {
        if (result.status === "created" || result.status === "updated" || result.status === "event_replay") {
            if (result.status === "event_replay" && !isReplayWithinRetention(result.receipt)) throw taskGone();
            return this.responseFromReceipt({
                taskId: result.receipt.taskId,
                eventId: result.receipt.eventId,
                eventHash: result.receipt.requestHash,
                acceptedRevision: result.receipt.acceptedRevision,
                currentSnapshotRef: result.receipt.currentSnapshotRef,
            }, result.task) as never;
        }
        if (result.status === "event_hash_conflict") throw new AgentTaskConflictException("event_payload");
        if (result.status === "active_task_conflict") throw new AgentTaskConflictException("active_task");
        if (result.status === "stale_revision") throw new AgentTaskConflictException("revision", asAuthorizedTask(result.currentTask));
        if (result.status === "task_expired" || result.status === "task_purged" || result.status === "session_archived" || result.status === "session_expired") throw taskGone();
        if (result.status === "not_found") throw new NotFoundException("Agent session not found");
        throw storageUnavailable();
    }

    private mapInternalMutation(result: InternalMutation): never {
        if (result.status === "updated" || result.status === "created" || result.status === "event_replay") {
            if (result.status === "event_replay" && !isReplayWithinRetention(result.receipt)) throw taskGone();
            return this.responseFromReceipt(eventReceipt(result.receipt, result.task), result.task) as never;
        }
        if (result.status === "event_hash_conflict") throw new AgentTaskConflictException("event_payload", result.task ? asAuthorizedTask(result.task) : undefined);
        if (result.status === "stale_revision") throw new AgentTaskConflictException("revision", asAuthorizedTask(result.currentTask));
        if (result.status === "state_conflict") throw new AgentTaskConflictException(result.reason, asAuthorizedTask(result.task));
        if (result.status === "task_expired" || result.status === "task_purged" || result.status === "session_archived" || result.status === "session_expired") throw taskGone();
        if (result.status === "not_found") throw new NotFoundException("Agent task not found");
        throw storageUnavailable();
    }

    private throwReadResult(result: Exclude<AgentTaskReadResult, { status: "found" }>): never {
        if (result.status === "not_found") throw new NotFoundException("Agent task not found");
        if (result.status === "storage_failure") throw storageUnavailable();
        throw taskGone();
    }

    private async mustReadTask(taskId: string, scope: AgentTaskSessionScope): Promise<{ task: AgentTaskEntity }> {
        const result = await this.repository.findOwned(taskId, scope);
        if (result.status === "found" || result.status === "task_expired") return { task: result.task };
        throw storageUnavailable();
    }
}
