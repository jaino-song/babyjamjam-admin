import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    GoneException,
    Inject,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import {
    AgentTaskCommandRequestSchema,
    AgentTaskCreateRequestSchema,
    AgentTaskIdSchema,
    AgentTaskPatchRequestSchema,
    applyClientInputOperations,
    createAgentTaskDefaults,
    evaluateClientReadiness,
    normalizeClientPhone,
    projectTaskForAuthorizedRest,
    type AgentTask,
    type AgentTaskCommandRequest,
    type AgentTaskCreateRequest,
    type AgentTaskEventReceipt,
    type AgentTaskPatchRequest,
    type AgentTaskRestoreMetadata,
    type ClientDuplicateCheckResult,
    type ClientInputOperation,
    type ClientInputState,
} from "@babyjamjam/shared";
import {
    canonicalChoiceDigest,
    type ConversationMutationOrigin,
} from "./conversation-task-policy";

import { AgentTaskPolicyService } from "application/agent/agent-task-policy.service";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import { assertPhoneAvailable } from "application/usecases/client/client-write-validation";
import { normalizePhone } from "application/utils/normalize-phone";
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
    type AgentTaskTransaction,
    type IAgentTaskRepository,
} from "domain/repositories/agent-task.repository.interface";
import { CLIENT_REPOSITORY, type IClientRepository } from "domain/repositories/client.repository.interface";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REPLAY_RETENTION_MS = TASK_RETENTION_MS;
const DYNAMIC_ISSUE_CODES = new Set(["task.required", "task.invalid", "task.duplicate", "task.stale"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

export type AgentTaskConflictReason = "revision" | "event_payload" | "state" | "active_task" | "consent_required";

export type AgentTaskMutationOrigin = ConversationMutationOrigin;

export type AgentTaskChoiceProducerKind = "client-target" | "phone-candidate";

export interface AgentTaskChoiceAttachmentInput {
    clientEventId?: string;
    expectedRevision: number;
    producer: AgentTaskChoiceProducerKind;
    /** Server-derived, branch-scoped identities. Numeric IDs never reach the model. */
    results: readonly ({
        label: string;
        description?: string;
        clientId?: number;
        normalizedPhone?: string;
        version?: string;
    })[];
}

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
    | { status: "forbidden"; message: string }
    | { status: "stale_revision"; currentTask: AgentTaskEntity }
    | { status: "state_conflict"; task: AgentTaskEntity; reason: "state" | "active_task" | "consent_required" }
    | { status: "not_found" | "session_archived" | "session_expired" | "task_expired" | "task_purged" | "storage_failure"; task?: AgentTaskEntity };

type AgentTaskTransactionLike = {
    ensureSessionRetention?: AgentTaskTransaction["ensureSessionRetention"];
};

type CommandTransition = {
    draft: AgentTaskDraft;
    status: AgentTaskEntity["status"];
    changed: boolean;
    targetRef?: string | null;
    targetVersion?: string | null;
    clearActionMetadata?: boolean;
};

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

function uuidFromDigest(digest: string): string {
    const normalized = digest.replace(/[^a-f0-9]/gi, "").toLowerCase().padEnd(32, "0").slice(0, 32);
    return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-5${normalized.slice(13, 16)}-${((Number.parseInt(normalized.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${normalized.slice(18, 20)}-${normalized.slice(20)}`;
}

function originSource(origin: AgentTaskMutationOrigin): AgentTaskDraft["provenance"]["confirmed"][string]["source"] {
    return origin;
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

    async create(
        principal: VerifiedTenantPrincipal,
        rawInput: unknown,
        origin: AgentTaskMutationOrigin = "user",
        requestHashOverride?: string,
    ): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask }> {
        const input = this.parseCreate(rawInput);
        await this.policy.assertCanCreate(principal, input.capabilityId);

        const scope = { ...taskOwner(principal), sessionId: input.sessionId };
        const requestHash = requestHashOverride ?? canonicalHash({
            operation: "create",
            sessionId: input.sessionId,
            capabilityId: input.capabilityId,
            operations: input.operations,
            origin,
        });

        // Resolve an existing event before creating a candidate task UUID. A
        // retry therefore cannot consume a new task identity or query client
        // data before returning its durable receipt.
        const prior = await this.lookupCreateEvent(scope, input.clientEventId, requestHash);
        if (prior.status !== "new") return this.mapCreateLookup(prior);

        const now = new Date();
        const taskId = randomUUID();
        const snapshotRef = randomUUID();
        const draft = await this.createDraft(principal, input, snapshotRef, origin);
        const result = await this.repository.createWithEvent(scope, {
            taskId,
            capabilityId: input.capabilityId,
            draft,
            status: input.capabilityId === "clients.update" ? "confirming_target" : "collecting",
            // Keep the row's acceptance timestamp and its retention deadline
            // anchored to the same instant.  The repository otherwise falls
            // back to the database clock for lastAcceptedAt, which can make
            // the exact retention interval drift by a few milliseconds.
            lastAcceptedAt: now,
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
        const owner = taskOwner(principal);
        const result = await this.repository.findOwned(parsedTaskId.data, owner);
        if (result.status === "found") return asAuthorizedTask(result.task);
        // Recovery is an explicitly narrower read.  It is consulted only
        // after the ordinary read has classified an owned task/session as
        // expired; foreign, purged and storage failures retain their normal
        // bounded semantics.
        if (result.status === "task_expired" || result.status === "session_expired" || result.status === "session_archived") {
            const recoveryRead = (this.repository as IAgentTaskRepository & {
                findOwnedRecovery?: IAgentTaskRepository["findOwnedRecovery"];
            }).findOwnedRecovery;
            if (recoveryRead) {
                const recovery = await recoveryRead.call(this.repository, parsedTaskId.data, owner);
                if (recovery.status === "found") return asAuthorizedTask(recovery.task);
                if (recovery.status === "storage_failure") throw storageUnavailable();
            }
        }
        this.throwReadResult(result);
    }

    async patch(
        principal: VerifiedTenantPrincipal,
        taskId: string,
        rawInput: unknown,
        origin: AgentTaskMutationOrigin = "user",
        requestHashOverride?: string,
        operationOrigins?: readonly AgentTaskMutationOrigin[],
    ): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask }> {
        const parsedTaskId = AgentTaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) throw invalidTaskInput();
        const input = this.parsePatch(rawInput);
        const owner = taskOwner(principal);
        const initial = await this.repository.findOwned(parsedTaskId.data, owner);
        if (initial.status !== "found" && initial.status !== "task_expired") this.throwReadResult(initial);
        this.policy.assertCanPatch(principal, initial.task.capabilityId);

        const scope = { ...owner, sessionId: initial.task.sessionId };
        const requestHash = requestHashOverride ?? canonicalHash({
            operation: "patch",
            taskId: parsedTaskId.data,
            sessionId: initial.task.sessionId,
            expectedRevision: input.expectedRevision,
            operations: input.operations,
            origin,
        });

        const result = await this.runPatchTransaction(principal, scope, parsedTaskId.data, input, requestHash, origin, operationOrigins);
        return this.mapInternalMutation(result);
    }

    async command(
        principal: VerifiedTenantPrincipal,
        taskId: string,
        rawInput: unknown,
        origin: AgentTaskMutationOrigin = "user",
        requestHashOverride?: string,
    ): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask }> {
        const parsedTaskId = AgentTaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) throw invalidTaskInput();
        const input = this.parseCommand(rawInput);
        const owner = taskOwner(principal);
        const initial = await this.repository.findOwned(parsedTaskId.data, owner);
        if (initial.status !== "found" && initial.status !== "task_expired" && initial.status !== "task_purged") this.throwReadResult(initial);

        const scope = { ...owner, sessionId: initial.status === "task_purged" ? initial.tombstone.sessionId : initial.task.sessionId };
        const canonicalCommand = this.canonicalCommand(input);
        const requestHash = requestHashOverride ?? canonicalHash({
            operation: "command",
            taskId: parsedTaskId.data,
            sessionId: scope.sessionId,
            expectedRevision: input.expectedRevision,
            command: canonicalCommand,
            origin,
        });
        const result = await this.runCommandTransaction(principal, scope, parsedTaskId.data, input, requestHash, origin);
        return this.mapInternalMutation(result);
    }

    async restoreSession(principal: VerifiedTenantPrincipal, sessionId: string): Promise<AgentTaskRestoreMetadata> {
        const scope = { ...taskOwner(principal), sessionId };
        const result = await this.repository.listOwned(scope);
        if (result.status === "not_found") throw new NotFoundException("Agent session not found");
        if (result.status === "storage_failure") throw storageUnavailable();
        const recoveryTaskIds = await this.listRecoveryTaskIds(scope);
        if (result.status === "session_archived") {
            return { activeTaskId: null, pausedTaskIds: [], taskRestoreStatus: "session_archived", recoveryTaskIds };
        }
        if (result.status === "session_expired") {
            return { activeTaskId: null, pausedTaskIds: [], taskRestoreStatus: "session_expired", recoveryTaskIds };
        }

        const now = Date.now();
        const live = result.tasks.filter((task) => task.purgedAt === null && task.expiresAt.getTime() > now);
        const active = live.find((task) => task.activeSlot === 1 && !TERMINAL_STATES.has(task.status));
        const pausedTaskIds = live.filter((task) => task.status === "paused").map((task) => task.taskId);
        return {
            activeTaskId: active?.taskId ?? null,
            pausedTaskIds: [...new Set(pausedTaskIds)].sort(),
            taskRestoreStatus: "available",
            recoveryTaskIds,
        };
    }

    // Explicit aliases keep the service easy to consume from route tests and
    // future command controllers without changing the ownership boundary.
    createTask = this.create.bind(this);
    getTask = this.get.bind(this);
    patchTask = this.patch.bind(this);
    commandTask = this.command.bind(this);

    /**
     * Internal conversation seam.  REST controllers never pass an origin or
     * hash override; the orchestrator calls these methods only after its
     * server-side policy/reference checks have completed.
     */
    createFromConversation(
        principal: VerifiedTenantPrincipal,
        rawInput: unknown,
        origin: AgentTaskMutationOrigin,
        requestHash: string,
    ) {
        return this.create(principal, rawInput, origin, requestHash);
    }

    patchFromConversation(
        principal: VerifiedTenantPrincipal,
        taskId: string,
        rawInput: unknown,
        origin: AgentTaskMutationOrigin,
        requestHash: string,
        operationOrigins?: readonly AgentTaskMutationOrigin[],
    ) {
        return this.patch(principal, taskId, rawInput, origin, requestHash, operationOrigins);
    }

    commandFromConversation(
        principal: VerifiedTenantPrincipal,
        taskId: string,
        rawInput: unknown,
        origin: AgentTaskMutationOrigin,
        requestHash: string,
    ) {
        return this.command(principal, taskId, rawInput, origin, requestHash);
    }

    /** Return all still-live tasks for the conversation context assembler. */
    async listForConversation(principal: VerifiedTenantPrincipal, sessionId: string): Promise<AgentTask[]> {
        const result = await this.repository.listOwned({ ...taskOwner(principal), sessionId });
        if (result.status === "not_found") throw new NotFoundException("Agent session not found");
        if (result.status === "storage_failure") throw storageUnavailable();
        if (result.status === "session_archived" || result.status === "session_expired") return [];
        const now = Date.now();
        return result.tasks
            .filter((task) => task.purgedAt === null && task.expiresAt.getTime() > now)
            .map(asAuthorizedTask);
    }

    /**
     * Persist a canonical conversation intake receipt without adding a draft
     * operation. This is used for question-only turns and for retries where
     * the parser has no new fact to apply.
     */
    async recordConversationIntake(
        principal: VerifiedTenantPrincipal,
        taskId: string,
        clientEventId: string,
        requestHash: string,
    ): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask }> {
        const parsedTaskId = AgentTaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success) throw invalidTaskInput();
        const owner = taskOwner(principal);
        const initial = await this.repository.findOwned(parsedTaskId.data, owner);
        if (initial.status !== "found" && initial.status !== "task_expired" && initial.status !== "task_purged") this.throwReadResult(initial);
        const sessionId = initial.status === "task_purged" ? initial.tombstone.sessionId : initial.task.sessionId;
        const raw = await this.repository.withTransaction({ ...owner, sessionId }, async (transaction): Promise<InternalMutation> => {
            const session = await transaction.lockSession();
            if (session.status !== "locked") return { status: session.status };
            const existing = await transaction.findEvent(clientEventId);
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
                return current.status === "task_purged" ? { status: "task_purged" } : { status: current.status };
            }
            const locked = await transaction.lockTask(parsedTaskId.data);
            if (locked.status === "not_found" || locked.status === "storage_failure") return locked;
            if (locked.status === "task_purged" || locked.status === "task_expired") return locked;
            const now = new Date();
            const inserted = await transaction.insertEvent({
                clientEventId,
                operation: "conversation:intake",
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
        });
        return this.mapInternalMutation(raw.status === "ok" || raw.status === "aborted" ? raw.value : raw.status === "event_hash_conflict" ? { status: "event_hash_conflict" } : { status: "storage_failure" });
    }

    /**
     * Resolve a message retry before parsing/selecting the current task. The
     * event's immutable task association remains authoritative.
     */
    async replayConversationIntake(
        principal: VerifiedTenantPrincipal,
        sessionId: string,
        clientEventId: string,
        requestHash: string,
    ): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask } | null> {
        const owner = taskOwner(principal);
        const raw = await this.repository.withTransaction({ ...owner, sessionId }, async (transaction): Promise<CreateEventLookup> => {
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
            if (current.status === "found" || current.status === "task_expired") return { status: "event_replay", task: current.task, event: existing.event };
            return current.status === "task_purged" ? { status: "task_purged" } : { status: current.status };
        });
        // A repository-level failure must never be interpreted as a missing
        // intake event: doing so would let a retry create a duplicate task.
        // The transaction result is intentionally mapped before inspecting
        // the value so storage failures retain their bounded 503 semantics.
        if (raw.status === "storage_failure") throw storageUnavailable();
        if (raw.status !== "ok" && raw.status !== "aborted") {
            if (raw.status === "active_task_conflict") throw new AgentTaskConflictException("active_task");
            if (raw.status === "event_hash_conflict") throw new AgentTaskConflictException("event_payload");
            throw storageUnavailable();
        }
        const value = raw.value;
        if (value.status === "new") return null;
        if (value.status === "event_hash_conflict") throw new AgentTaskConflictException("event_payload", value.task ? asAuthorizedTask(value.task) : undefined);
        if (value.status === "event_replay") {
            if (!isReplayWithinRetention(value.event)) throw taskGone();
            return this.responseFromReceipt(eventReceipt(value.event, value.task), value.task);
        }
        if (value.status === "task_purged" || value.status === "session_archived" || value.status === "session_expired") throw taskGone();
        if (value.status === "not_found") throw new NotFoundException("Agent session not found");
        throw storageUnavailable();
    }

    /**
     * Attach a fresh, server-derived result set to a live task. Choices are
     * revisioned task state, never a session-retention mutation.
     */
    async attachChoices(
        principal: VerifiedTenantPrincipal,
        taskId: string,
        input: AgentTaskChoiceAttachmentInput,
    ): Promise<{ receipt: AgentTaskEventReceipt; snapshot: AgentTask }> {
        const parsedTaskId = AgentTaskIdSchema.safeParse(taskId);
        if (!parsedTaskId.success || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw invalidTaskInput();
        if (input.producer !== "client-target" && input.producer !== "phone-candidate") throw invalidTaskInput();
        const owner = taskOwner(principal);
        const initial = await this.repository.findOwned(parsedTaskId.data, owner);
        if (initial.status !== "found" && initial.status !== "task_expired") this.throwReadResult(initial);
        const scope = { ...owner, sessionId: initial.task.sessionId };
        const prepared = await this.prepareChoiceResults(principal, input);
        const requestHash = canonicalChoiceDigest({
            taskId: parsedTaskId.data,
            expectedRevision: input.expectedRevision,
            producer: input.producer,
            results: prepared.canonical,
        });
        const clientEventId = uuidFromDigest(canonicalHash({
            protocol: "agent-task-choice-attachment-v1",
            scope,
            taskId: parsedTaskId.data,
            expectedRevision: input.expectedRevision,
            producer: input.producer,
            requestHash,
        }));
        const raw = await this.repository.withTransaction(scope, async (transaction): Promise<InternalMutation> => {
            const session = await transaction.lockSession();
            if (session.status !== "locked") return { status: session.status };
            const existing = await transaction.findEvent(clientEventId);
            if (existing.status === "storage_failure") return existing;
            if (existing.status === "found") {
                if (existing.event.requestHash !== requestHash) {
                    const current = await transaction.readTask(existing.event.taskId);
                    return { status: "event_hash_conflict", ...(current.status === "found" || current.status === "task_expired" ? { task: current.task } : {}) };
                }
                const current = await transaction.readTask(existing.event.taskId);
                if (current.status === "found" || current.status === "task_expired") return { status: "event_replay", task: current.task, receipt: existing.event };
                return current.status === "task_purged" ? { status: "task_purged" } : { status: current.status };
            }
            const locked = await transaction.lockTask(parsedTaskId.data);
            if (locked.status === "not_found" || locked.status === "storage_failure") return locked;
            if (locked.status === "task_expired" || locked.status === "task_purged") return locked;
            const task = locked.task;
            if (task.revision !== input.expectedRevision) return { status: "stale_revision", currentTask: task };
            if (task.activeSlot !== 1 || task.activeActionId !== null || !["collecting", "confirming_target", "review_ready"].includes(task.status)) {
                return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task });
            }
            if (input.producer === "client-target" && task.targetRef !== null) {
                return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task });
            }

            const mappings = this.validateChoiceProducerMappings(task, input.producer);
            if (prepared.entries.length === 0) {
                const now = new Date();
                const inserted = await transaction.insertEvent({
                    clientEventId,
                    operation: `choices:${input.producer}:empty`,
                    requestHash,
                    acceptedRevision: task.revision,
                    acceptedAt: now,
                });
                if (inserted.status !== "inserted") {
                    return transaction.abort<InternalMutation>(inserted.status === "event_hash_conflict" ? { status: "event_hash_conflict" } : { status: "storage_failure" });
                }
                return { status: "updated", task, receipt: inserted.event };
            }

            const choiceSetRef = randomUUID();
            const options = prepared.entries.map((entry, index) => ({
                optionId: randomUUID(),
                label: input.producer === "phone-candidate" ? `전화번호 후보 ${index + 1}` : entry.label,
                ...(entry.description ? { description: entry.description } : {}),
            }));
            const choiceSet = { choiceSetRef, options };
            const preservedSets = task.draft.choiceSets.filter((set) => !mappings.refs.has(set.choiceSetRef));
            const preservedOrder = task.draft.orderedChoiceRefs.filter((ref) => !mappings.refs.has(ref));
            const preservedTargets = task.draft.server.references.choiceTargets.filter((mapping) => !mappings.refs.has(mapping.choiceSetRef));
            const preservedPhones = Object.fromEntries(Object.entries(task.draft.server.references.phoneCandidates)
                .filter(([ref]) => !mappings.refs.has(ref)));
            const choiceTargets = input.producer === "client-target"
                ? options.map((option, index) => ({ choiceSetRef, optionId: option.optionId, clientId: prepared.entries[index]!.clientId! }))
                : preservedTargets;
            const phoneCandidates = input.producer === "phone-candidate"
                ? { ...preservedPhones, [choiceSetRef]: options.map((option, index) => ({ candidateRef: option.optionId, normalizedPhone: prepared.entries[index]!.normalizedPhone! })) }
                : preservedPhones;
            const issues = task.draft.issues.filter((issue) => !(input.producer === "client-target" && ["task.required", "task.stale"].includes(issue.code) && issue.field === undefined));
            const draft: AgentTaskDraft = {
                ...task.draft,
                choiceSets: [...preservedSets, choiceSet],
                orderedChoiceRefs: [...preservedOrder, choiceSetRef],
                issues,
                server: { ...task.draft.server, references: { ...task.draft.server.references, choiceTargets, phoneCandidates } },
                currentSnapshotRef: randomUUID(),
            };
            const now = new Date();
            const updated = await transaction.updateTask({
                expectedRevision: input.expectedRevision,
                draft,
                status: "confirming_target",
                preserveLastAcceptedAt: true,
            });
            if (updated.status !== "updated") {
                if (updated.status === "stale_revision") return updated;
                if (updated.status === "task_expired" || updated.status === "task_purged") return updated;
                return transaction.abort<InternalMutation>({ status: "storage_failure" });
            }
            const inserted = await transaction.insertEvent({
                clientEventId,
                operation: `choices:${input.producer}`,
                requestHash,
                acceptedRevision: updated.task.revision,
                acceptedAt: now,
            });
            if (inserted.status !== "inserted") {
                return transaction.abort<InternalMutation>(inserted.status === "event_hash_conflict" ? { status: "event_hash_conflict" } : { status: "storage_failure" });
            }
            return { status: "updated", task: updated.task, receipt: inserted.event };
        });
        return this.mapInternalMutation(raw.status === "ok" || raw.status === "aborted" ? raw.value : raw.status === "event_hash_conflict" ? { status: "event_hash_conflict" } : { status: "storage_failure" });
    }

    private async prepareChoiceResults(
        principal: VerifiedTenantPrincipal,
        input: AgentTaskChoiceAttachmentInput,
    ): Promise<{
        entries: Array<AgentTaskChoiceAttachmentInput["results"][number]>;
        canonical: Array<Record<string, unknown>>;
    }> {
        if (input.results.length > 100) throw invalidTaskInput();
        const entries: Array<AgentTaskChoiceAttachmentInput["results"][number]> = [];
        const canonical: Array<Record<string, unknown>> = [];
        for (const [index, raw] of input.results.entries()) {
            if (!raw || typeof raw.label !== "string" || raw.label.trim().length === 0 || raw.label.length > 300) throw invalidTaskInput();
            if (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.length > 1000)) throw invalidTaskInput();
            if (input.producer === "client-target") {
                if (!Number.isSafeInteger(raw.clientId) || (raw.clientId ?? 0) <= 0) throw invalidTaskInput();
                const client = await this.clientRepository.findById(principal.branchId, raw.clientId!);
                if (!client) throw new AgentTaskConflictException("state");
                const version = clientAgentTargetVersion(client);
                const entry = { label: client.name.slice(0, 300), ...(raw.description ? { description: raw.description } : {}), clientId: client.id, version };
                entries.push(entry);
                canonical.push({ order: index, identityDigest: canonicalHash({ clientId: client.id }), versionDigest: canonicalHash(version), labelDigest: canonicalHash(entry.label), ...(entry.description ? { descriptionDigest: canonicalHash(entry.description) } : {}) });
            } else {
                const normalizedPhone = normalizePhone(raw.normalizedPhone ?? "");
                if (!normalizedPhone || !/^\d{9,11}$/.test(normalizedPhone)) throw invalidTaskInput();
                const entry = { label: `전화번호 후보 ${index + 1}`, ...(raw.description ? { description: raw.description } : {}), normalizedPhone, ...(raw.version ? { version: raw.version } : {}) };
                entries.push(entry);
                canonical.push({ order: index, identityDigest: canonicalHash(normalizedPhone), ...(raw.version ? { versionDigest: canonicalHash(raw.version) } : {}) });
            }
        }
        return { entries, canonical };
    }

    private validateChoiceProducerMappings(
        task: AgentTaskEntity,
        producer: AgentTaskChoiceProducerKind,
    ): { refs: Set<string> } {
        const choiceSetRefs = new Set(task.draft.choiceSets.map((set) => set.choiceSetRef));
        const orderedRefs = new Set(task.draft.orderedChoiceRefs);
        if ([...orderedRefs].some((ref) => !choiceSetRefs.has(ref))) throw new AgentTaskConflictException("state");
        const targetRefs = new Set(task.draft.server.references.choiceTargets.map((mapping) => mapping.choiceSetRef));
        const phoneRefs = new Set(Object.keys(task.draft.server.references.phoneCandidates));
        if ([...targetRefs].some((ref) => !choiceSetRefs.has(ref)) || [...phoneRefs].some((ref) => !choiceSetRefs.has(ref))) throw new AgentTaskConflictException("state");
        if ([...targetRefs].some((ref) => phoneRefs.has(ref))) throw new AgentTaskConflictException("state");
        const existingProducerRefs = producer === "client-target" ? targetRefs : phoneRefs;
        const unrelatedRefs = producer === "client-target" ? phoneRefs : targetRefs;
        if ([...unrelatedRefs].some((ref) => existingProducerRefs.has(ref))) throw new AgentTaskConflictException("state");
        return { refs: existingProducerRefs };
    }

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

    private parseCommand(rawInput: unknown): AgentTaskCommandRequest {
        try {
            return AgentTaskCommandRequestSchema.parse(rawInput);
        } catch {
            throw invalidTaskInput();
        }
    }

    private canonicalCommand(input: AgentTaskCommandRequest): Record<string, unknown> {
        if (input.command === "select-target") {
            return {
                command: input.command,
                choiceSetRef: "choiceSetRef" in input ? input.choiceSetRef : input.choiceSetId,
                optionId: input.optionId,
            };
        }
        if (input.command === "start-update") {
            return {
                command: input.command,
                targetRef: input.targetRef,
                expectedTargetVersion: input.expectedTargetVersion,
            };
        }
        return { command: input.command };
    }

    private async listRecoveryTaskIds(scope: AgentTaskSessionScope): Promise<string[]> {
        const listRecovery = (this.repository as IAgentTaskRepository & {
            listOwnedRecovery?: IAgentTaskRepository["listOwnedRecovery"];
        }).listOwnedRecovery;
        if (!listRecovery) return [];
        const result = await listRecovery.call(this.repository, scope);
        if (result.status === "not_found") throw new NotFoundException("Agent session not found");
        if (result.status === "storage_failure") throw storageUnavailable();
        return [...new Set(result.taskIds)].sort();
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
        origin: AgentTaskMutationOrigin = "user",
    ): Promise<AgentTaskDraft> {
        const state = applyClientInputOperations(input.operations, {
            confirmed: input.capabilityId === "clients.create" ? createAgentTaskDefaults() : {},
            tentative: {},
            clearedFields: [],
            automationChoice: "unanswered",
            noSend: false,
        });
        const provenance = this.applyProvenance({ confirmed: {}, tentative: {} }, input.operations, input.clientEventId, origin);
        const duplicateCheck = input.capabilityId === "clients.update"
            ? { status: "not_checked" as const }
            : await this.duplicateCheck(principal, state, undefined);
        const issues = input.capabilityId === "clients.update"
            ? await this.updateIssues(principal, state, null, [])
            : this.issues([], state, duplicateCheck);
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
        origin: AgentTaskMutationOrigin = "user",
        operationOrigins?: readonly AgentTaskMutationOrigin[],
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
                next = await this.nextDraft(principal, locked.task, input.operations, input.clientEventId, origin, operationOrigins);
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
            const changedBeforeReviewDemotion = this.hasSemanticDraftChange(locked.task.draft, next.draft);
            const changed = changedBeforeReviewDemotion || next.status !== locked.task.status;
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

            // Review-only action metadata is cleared only after a genuine
            // semantic edit has been established. Keeping it through the
            // comparison prevents metadata cleanup from manufacturing a
            // revision for a review-ready no-op.
            next.draft.server = {
                ...next.draft.server,
                actionExpectedRevision: undefined,
                actionProposalRevision: undefined,
            };
            if (locked.task.status === "review_ready") {
                next.status = await this.demotedStatus(principal, locked.task);
            }

            next.draft.currentSnapshotRef = randomUUID();

            if (!await this.ensureRetention(transaction, new Date(now.getTime() + TASK_RETENTION_MS))) {
                return transaction.abort<InternalMutation>({ status: "storage_failure" });
            }

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

    private async runCommandTransaction(
        principal: VerifiedTenantPrincipal,
        scope: AgentTaskSessionScope,
        taskId: string,
        input: AgentTaskCommandRequest,
        requestHash: string,
        origin: AgentTaskMutationOrigin = "user",
    ): Promise<InternalMutation> {
        const operation = `command:${input.command}`;
        const raw = await this.repository.withTransaction(scope, async (transaction): Promise<InternalMutation> => {
            const session = await transaction.lockSession();
            if (session.status !== "locked") return { status: session.status };

            // Event lookup intentionally precedes task selection, expiry,
            // revision, action and role/state checks. A retry therefore stays
            // tied to the task recorded on its original receipt even if a
            // later task became active or the source task changed state.
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

            const locked = await transaction.lockTask(taskId);
            if (locked.status === "not_found" || locked.status === "storage_failure") return locked;

            if (locked.status === "task_expired" || locked.status === "task_purged") return locked;
            if (input.expectedRevision !== locked.task.revision) {
                return { status: "stale_revision", currentTask: locked.task };
            }
            if (locked.task.activeActionId !== null) {
                return { status: "state_conflict", reason: "active_task", task: locked.task };
            }
            if (!this.commandStateAllowed(locked.task.status, input.command)) {
                return { status: "state_conflict", reason: "state", task: locked.task };
            }

            try {
                if (input.command === "start-update") {
                    const assertStartUpdate = (this.policy as AgentTaskPolicyService & {
                        assertCanStartUpdate?: AgentTaskPolicyService["assertCanStartUpdate"];
                    }).assertCanStartUpdate;
                    if (assertStartUpdate) await assertStartUpdate.call(this.policy, principal);
                    else {
                        await this.policy.assertCanCreate(principal, "clients.create");
                        await this.policy.assertCanCreate(principal, "clients.update");
                        this.policy.assertCanPatch(principal, locked.task.capabilityId);
                    }
                } else if (input.command === "prepare-review") {
                    const assertPrepare = (this.policy as AgentTaskPolicyService & {
                        assertCanPrepareReview?: AgentTaskPolicyService["assertCanPrepareReview"];
                    }).assertCanPrepareReview;
                    if (assertPrepare) await assertPrepare.call(this.policy, principal, locked.task.capabilityId);
                    else this.policy.assertCanPatch(principal, locked.task.capabilityId);
                } else {
                    this.policy.assertCanPatch(principal, locked.task.capabilityId);
                }
            } catch (error) {
                if (error instanceof ForbiddenException) {
                    return transaction.abort<InternalMutation>({ status: "forbidden", message: error.message });
                }
                throw error;
            }

            if (input.command === "start-update") {
                return this.runStartUpdateTransaction(principal, scope, locked.task, input, requestHash, transaction);
            }

            let transition: CommandTransition;
            try {
                transition = await this.nextCommand(principal, locked.task, input, origin);
            } catch (error) {
                if (error instanceof AgentTaskConflictException) {
                    return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task: locked.task });
                }
                throw error;
            }

            const now = new Date();
            if (!transition.changed) {
                const inserted = await transaction.insertEvent({
                    clientEventId: input.clientEventId,
                    operation,
                    requestHash,
                    acceptedRevision: locked.task.revision,
                    acceptedAt: now,
                });
                if (inserted.status !== "inserted") {
                    return transaction.abort<InternalMutation>(
                        inserted.status === "event_hash_conflict"
                            ? { status: "event_hash_conflict" }
                            : { status: "storage_failure" },
                    );
                }
                return { status: "updated", task: locked.task, receipt: inserted.event };
            }

            let draft = transition.draft;
            if (transition.clearActionMetadata) {
                draft = {
                    ...draft,
                    server: {
                        ...draft.server,
                        actionExpectedRevision: undefined,
                        actionProposalRevision: undefined,
                    },
                };
            }
            draft.currentSnapshotRef = randomUUID();
            const expiresAt = input.command === "cancel"
                ? new Date(now.getTime() + TERMINAL_RETENTION_MS)
                : new Date(now.getTime() + TASK_RETENTION_MS);
            if (!await this.ensureRetention(transaction, expiresAt)) {
                return transaction.abort<InternalMutation>({ status: "storage_failure" });
            }
            const updated = await transaction.updateTask({
                expectedRevision: input.expectedRevision,
                draft,
                status: transition.status,
                ...(transition.targetRef === undefined ? {} : { targetRef: transition.targetRef }),
                ...(transition.targetVersion === undefined ? {} : { targetVersion: transition.targetVersion }),
                acceptedAt: now,
                expiresAt,
                ...(input.command === "cancel" ? { terminalAt: now } : {}),
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
                operation,
                requestHash,
                acceptedRevision: updated.task.revision,
                acceptedAt: now,
            });
            if (inserted.status !== "inserted") {
                return transaction.abort<InternalMutation>(
                    inserted.status === "event_hash_conflict"
                        ? { status: "event_hash_conflict" }
                        : { status: "storage_failure" },
                );
            }
            return { status: "updated", task: updated.task, receipt: inserted.event };
        });

        if (raw.status === "ok" || raw.status === "aborted") return raw.value;
        if (raw.status === "active_task_conflict") {
            return { status: "state_conflict", reason: "active_task", task: (await this.mustReadTask(taskId, scope)).task };
        }
        if (raw.status === "event_hash_conflict") return { status: "event_hash_conflict" };
        return { status: "storage_failure" };
    }

    /**
     * Convert an accepted duplicate registration draft into a scoped client
     * update in the same task UoW. The source update is deliberately performed
     * before createTask: the transaction adapter's locked-task cursor then
     * points at the new task so the single receipt references that task.
     */
    private async runStartUpdateTransaction(
        principal: VerifiedTenantPrincipal,
        scope: AgentTaskSessionScope,
        source: AgentTaskEntity,
        input: Extract<AgentTaskCommandRequest, { command: "start-update" }>,
        requestHash: string,
        transaction: AgentTaskTransaction,
    ): Promise<InternalMutation> {
        if (
            source.capabilityId !== "clients.create"
            || source.activeSlot !== 1
            || source.activeActionId !== null
            || !["collecting", "confirming_target", "review_ready"].includes(source.status)
            || source.targetRef === null
            || source.targetVersion === null
        ) {
            return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task: source });
        }

        const protectedTarget = source.draft.server.references.target;
        if (!protectedTarget || protectedTarget.targetRef !== source.targetRef) {
            return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task: source });
        }
        if (input.targetRef !== source.targetRef || input.expectedTargetVersion !== source.targetVersion) {
            return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task: source });
        }
        // A source with any client-target mapping has an unresolved target
        // choice (including an orphaned/malformed mapping), so it cannot be
        // converted. Phone candidates are independent and may remain queued
        // on the source; choices are intentionally not copied to the update.
        try {
            this.validateChoiceProducerMappings(source, "client-target");
            this.validateChoiceProducerMappings(source, "phone-candidate");
        } catch {
            return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task: source });
        }
        if (source.draft.server.references.choiceTargets.length > 0) {
            return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task: source });
        }

        let targetClient: Awaited<ReturnType<IClientRepository["findById"]>>;
        try {
            targetClient = await this.clientRepository.findById(principal.branchId, protectedTarget.clientId);
        } catch (error) {
            if (error instanceof ServiceUnavailableException) throw error;
            return transaction.abort<InternalMutation>({ status: "storage_failure" });
        }
        if (!targetClient || clientAgentTargetVersion(targetClient) !== source.targetVersion) {
            return transaction.abort<InternalMutation>({ status: "state_conflict", reason: "state", task: source });
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + TASK_RETENTION_MS);
        if (!await this.ensureRetention(transaction, expiresAt)) {
            return transaction.abort<InternalMutation>({ status: "storage_failure" });
        }

        const sourceDraft: AgentTaskDraft = {
            ...source.draft,
            currentSnapshotRef: randomUUID(),
        };
        const sourceUpdated = await transaction.updateTask({
            expectedRevision: input.expectedRevision,
            draft: sourceDraft,
            status: "paused",
            acceptedAt: now,
            expiresAt,
        });
        if (sourceUpdated.status !== "updated") {
            if (sourceUpdated.status === "stale_revision") return sourceUpdated;
            if (sourceUpdated.status === "task_expired" || sourceUpdated.status === "task_purged") return sourceUpdated;
            if (sourceUpdated.status === "active_task_conflict") {
                return { status: "state_conflict", reason: "active_task", task: source };
            }
            return transaction.abort<InternalMutation>({ status: "storage_failure" });
        }

        const transferredConfirmed: AgentTaskEntity["draft"]["confirmed"] = {};
        const transferredTentative: AgentTaskEntity["draft"]["tentative"] = {};
        const transferredProvenance: AgentTaskDraft["provenance"] = { confirmed: {}, tentative: {} };
        const transfer = (bucket: "confirmed" | "tentative") => {
            const values = source.draft[bucket];
            const provenance = source.draft.provenance[bucket];
            const destination = bucket === "confirmed" ? transferredConfirmed : transferredTentative;
            for (const [field, value] of Object.entries(values)) {
                const provenanceEntry = provenance[field];
                if (!provenanceEntry || !["user", "wizard"].includes(provenanceEntry.source)) continue;
                (destination as Record<string, unknown>)[field] = value;
                transferredProvenance[bucket][field] = {
                    source: provenanceEntry.source,
                    capturedAt: now.toISOString(),
                    eventId: input.clientEventId,
                    valueRef: randomUUID(),
                };
            }
        };
        transfer("confirmed");
        transfer("tentative");

        const targetRef = randomUUID();
        const state: ClientInputState = {
            confirmed: transferredConfirmed,
            tentative: transferredTentative,
            clearedFields: [],
            automationChoice: "unanswered",
            noSend: source.draft.constraints.noSend,
        };
        const empty = createEmptyAgentTaskDraft(randomUUID());
        const newTaskDraft: AgentTaskDraft = {
            ...empty,
            confirmed: transferredConfirmed,
            tentative: transferredTentative,
            provenance: transferredProvenance,
            constraints: { noSend: state.noSend },
            consent: { choice: "unanswered", binding: null },
            server: {
                ...empty.server,
                references: {
                    ...empty.server.references,
                    target: { targetRef, clientId: targetClient.id },
                },
            },
        };
        newTaskDraft.issues = await this.updateIssues(
            principal,
            state,
            {
                ...source,
                taskId: "conversion",
                capabilityId: "clients.update",
                status: "collecting",
                targetRef,
                targetVersion: source.targetVersion,
                draft: newTaskDraft,
            },
            [],
            { targetRef, targetVersion: source.targetVersion, targetClient },
        );

        const newTaskId = randomUUID();
        const created = await transaction.createTask({
            taskId: newTaskId,
            capabilityId: "clients.update",
            draft: newTaskDraft,
            status: "collecting",
            revision: 1,
            targetRef,
            targetVersion: source.targetVersion,
            lastAcceptedAt: now,
            expiresAt,
        });
        if (created.status !== "created") {
            if (created.status === "active_task_conflict") {
                return { status: "state_conflict", reason: "active_task", task: source };
            }
            return transaction.abort<InternalMutation>({ status: "storage_failure" });
        }
        const inserted = await transaction.insertEvent({
            clientEventId: input.clientEventId,
            operation: "command:start-update",
            requestHash,
            acceptedRevision: created.task.revision,
            acceptedAt: now,
        });
        if (inserted.status !== "inserted") {
            return transaction.abort<InternalMutation>(
                inserted.status === "event_hash_conflict"
                    ? { status: "event_hash_conflict" }
                    : { status: "storage_failure" },
            );
        }
        return { status: "updated", task: created.task, receipt: inserted.event };
    }

    private commandStateAllowed(status: AgentTaskEntity["status"], command: AgentTaskCommandRequest["command"]): boolean {
        if (command === "pause") return ["collecting", "confirming_target", "review_ready", "paused"].includes(status);
        if (command === "resume") return ["collecting", "confirming_target", "review_ready", "paused"].includes(status);
        if (command === "cancel") return ["collecting", "confirming_target", "review_ready", "paused"].includes(status);
        if (command === "prepare-review") return ["collecting", "confirming_target", "review_ready"].includes(status);
        return ["collecting", "confirming_target", "review_ready"].includes(status);
    }

    private async nextCommand(
        principal: VerifiedTenantPrincipal,
        task: AgentTaskEntity,
        input: AgentTaskCommandRequest,
        origin: AgentTaskMutationOrigin = "user",
    ): Promise<CommandTransition> {
        if (input.command === "pause") {
            if (task.status === "paused") return { draft: task.draft, status: task.status, changed: false };
            return { draft: task.draft, status: "paused", changed: true };
        }
        if (input.command === "resume") {
            if (task.status !== "paused") return { draft: task.draft, status: task.status, changed: false };
            const status = task.draft.orderedChoiceRefs.length > 0 ? "confirming_target" : "collecting";
            return { draft: task.draft, status, changed: true };
        }
        if (input.command === "cancel") return { draft: task.draft, status: "cancelled", changed: true };
        if (input.command === "prepare-review") {
            const readiness = await this.reviewReadiness(principal, task);
            if (!readiness.ready) throw new AgentTaskConflictException("state", asAuthorizedTask(task));
            if (task.status === "review_ready") return { draft: task.draft, status: task.status, changed: false };
            return { draft: { ...task.draft, issues: readiness.issues }, status: "review_ready", changed: true };
        }
        if (input.command !== "select-target") {
            throw new AgentTaskConflictException("state", asAuthorizedTask(task));
        }
        return this.selectTarget(principal, task, input, origin);
    }

    private async reviewReadiness(
        principal: VerifiedTenantPrincipal,
        task: AgentTaskEntity,
    ): Promise<{ ready: boolean; issues: AgentTaskEntity["draft"]["issues"] }> {
        if (task.draft.orderedChoiceRefs.length > 0) return { ready: false, issues: task.draft.issues };
        const state = {
            confirmed: task.draft.confirmed,
            tentative: task.draft.tentative,
            clearedFields: task.draft.clearedFields,
            automationChoice: task.draft.consent.choice,
            noSend: task.draft.constraints.noSend,
        } satisfies ClientInputState;
        const issues = task.capabilityId === "clients.update"
            ? await this.updateIssues(principal, state, task, task.draft.issues)
            : this.issues(task.draft.issues, state, await this.duplicateCheck(principal, state, undefined));
        return { ready: issues.length === 0, issues };
    }

    private async selectTarget(
        principal: VerifiedTenantPrincipal,
        task: AgentTaskEntity,
        input: Extract<AgentTaskCommandRequest, { command: "select-target" }>,
        origin: AgentTaskMutationOrigin = "user",
    ): Promise<CommandTransition> {
        const choiceSetRef = "choiceSetRef" in input ? input.choiceSetRef : input.choiceSetId;
        const choiceSet = task.draft.choiceSets.find((candidate) => candidate.choiceSetRef === choiceSetRef);
        if (!choiceSet || !task.draft.orderedChoiceRefs.includes(choiceSetRef)) {
            throw new AgentTaskConflictException("state", asAuthorizedTask(task));
        }
        if (choiceSet.expiresAt && Date.parse(choiceSet.expiresAt) <= Date.now()) {
            throw new AgentTaskConflictException("state", asAuthorizedTask(task));
        }
        if (!choiceSet.options.some((option) => option.optionId === input.optionId)) {
            throw new AgentTaskConflictException("state", asAuthorizedTask(task));
        }

        const targetMappings = task.draft.server.references.choiceTargets.filter((candidate) => candidate.choiceSetRef === choiceSetRef);
        const phoneSetPresent = Object.prototype.hasOwnProperty.call(task.draft.server.references.phoneCandidates, choiceSetRef);
        if ((phoneSetPresent && targetMappings.length > 0) || (!phoneSetPresent && targetMappings.length === 0)) {
            throw new AgentTaskConflictException("state", asAuthorizedTask(task));
        }

        let draft: AgentTaskDraft;
        let targetRef: string | null | undefined;
        let targetVersion: string | null | undefined;
        let selectedTargetClient: Awaited<ReturnType<IClientRepository["findById"]>> | undefined;
        if (phoneSetPresent) {
            const candidates = task.draft.server.references.phoneCandidates[choiceSetRef] ?? [];
            const candidate = candidates.find((value) => value.candidateRef === input.optionId);
            if (!candidate || candidates.filter((value) => value.candidateRef === input.optionId).length !== 1) {
                throw new AgentTaskConflictException("state", asAuthorizedTask(task));
            }
            const operations = [{ op: "set", field: "phone", value: candidate.normalizedPhone }] as ClientInputOperation[];
            const state = applyClientInputOperations(operations, {
                confirmed: task.draft.confirmed,
                tentative: task.draft.tentative,
                clearedFields: task.draft.clearedFields,
                automationChoice: task.draft.consent.choice,
                noSend: task.draft.constraints.noSend,
            });
            const provenance = this.applyProvenance(task.draft.provenance, operations, input.clientEventId, origin);
            const issues = task.capabilityId === "clients.update"
                ? await this.updateIssues(principal, state, task, task.draft.issues)
                : this.issues(task.draft.issues, state, await this.duplicateCheck(principal, state, undefined));
            const phoneCandidates = { ...task.draft.server.references.phoneCandidates };
            delete phoneCandidates[choiceSetRef];
            draft = {
                ...task.draft,
                confirmed: state.confirmed,
                tentative: state.tentative,
                clearedFields: state.clearedFields,
                provenance,
                issues,
                choiceSets: task.draft.choiceSets.filter((value) => value.choiceSetRef !== choiceSetRef),
                orderedChoiceRefs: task.draft.orderedChoiceRefs.filter((value) => value !== choiceSetRef),
                server: {
                    ...task.draft.server,
                    references: { ...task.draft.server.references, phoneCandidates },
                },
            };
        } else {
            const mappings = targetMappings.filter((candidate) => candidate.optionId === input.optionId);
            if (mappings.length !== 1) throw new AgentTaskConflictException("state", asAuthorizedTask(task));
            const mapping = mappings[0]!;
            const client = await this.clientRepository.findById(principal.branchId, mapping.clientId);
            if (!client) throw new AgentTaskConflictException("state", asAuthorizedTask(task));
            selectedTargetClient = client;
            targetRef = mapping.choiceSetRef;
            targetVersion = clientAgentTargetVersion(client);
            draft = {
                ...task.draft,
                choiceSets: task.draft.choiceSets.filter((value) => value.choiceSetRef !== choiceSetRef),
                orderedChoiceRefs: task.draft.orderedChoiceRefs.filter((value) => value !== choiceSetRef),
                server: {
                    ...task.draft.server,
                    references: {
                        ...task.draft.server.references,
                        target: { targetRef: mapping.choiceSetRef, clientId: mapping.clientId },
                        choiceTargets: task.draft.server.references.choiceTargets.filter((value) => value.choiceSetRef !== choiceSetRef),
                    },
                },
            };
        }
        if (task.capabilityId === "clients.update" && selectedTargetClient && targetRef && targetVersion) {
            // Recompute dynamic readiness against the freshly selected,
            // branch-scoped target. The selection only consumes protected
            // references; it never copies the customer's current PII into
            // the task draft.
            const state: ClientInputState = {
                confirmed: task.draft.confirmed,
                tentative: task.draft.tentative,
                clearedFields: task.draft.clearedFields,
                automationChoice: task.draft.consent.choice,
                noSend: task.draft.constraints.noSend,
            };
            const issues = await this.updateIssues(principal, state, task, draft.issues, {
                targetRef,
                targetVersion,
                targetClient: selectedTargetClient,
            });
            draft = { ...draft, issues };
        }
        const status = draft.orderedChoiceRefs.length > 0 ? "confirming_target" : "collecting";
        return {
            draft,
            status,
            changed: true,
            targetRef,
            targetVersion,
            clearActionMetadata: task.status === "review_ready",
        };
    }

    private async ensureRetention(transaction: AgentTaskTransactionLike, minExpiry: Date): Promise<boolean> {
        const ensure = transaction.ensureSessionRetention;
        if (typeof ensure !== "function") return true;
        const result = await ensure.call(transaction, minExpiry);
        return result.status !== "storage_failure";
    }

    private async nextDraft(
        principal: VerifiedTenantPrincipal,
        task: AgentTaskEntity,
        operations: readonly ClientInputOperation[],
        clientEventId: string,
        origin: AgentTaskMutationOrigin = "user",
        operationOrigins?: readonly AgentTaskMutationOrigin[],
    ): Promise<{ draft: AgentTaskDraft; status: AgentTaskEntity["status"] }> {
        const state = applyClientInputOperations(operations, {
            confirmed: task.draft.confirmed,
            tentative: task.draft.tentative,
            clearedFields: task.draft.clearedFields,
            automationChoice: task.draft.consent.choice,
            noSend: task.draft.constraints.noSend,
        });
        const bindingRemainsValid = this.consentBindingRemainsValid(task, operations);
        if (state.automationChoice === "yes" && !bindingRemainsValid) {
            throw new AgentTaskConflictException("consent_required", asAuthorizedTask(task));
        }

        const provenance = this.applyProvenance(task.draft.provenance, operations, clientEventId, origin, operationOrigins);
        const issues = task.capabilityId === "clients.update"
            ? await this.updateIssues(principal, state, task, task.draft.issues)
            : this.issues(task.draft.issues, state, await this.duplicateCheck(principal, state, undefined));
        const discardsPhone = operations.some((operation) => operation.op === "discard-change" && operation.field === "phone");
        const discardedPhoneChoiceSetRefs = discardsPhone
            ? new Set(Object.keys(task.draft.server.references.phoneCandidates))
            : new Set<string>();
        const choiceSets = task.draft.choiceSets.filter((choiceSet) => !discardedPhoneChoiceSetRefs.has(choiceSet.choiceSetRef));
        const orderedChoiceRefs = task.draft.orderedChoiceRefs.filter((choiceSetRef) => !discardedPhoneChoiceSetRefs.has(choiceSetRef));
        const choiceTargets = task.draft.server.references.choiceTargets.filter(
            (choiceTarget) => !discardedPhoneChoiceSetRefs.has(choiceTarget.choiceSetRef),
        );
        const binding = state.automationChoice === "yes" && bindingRemainsValid
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
            },
        };
        return { draft, status: task.status };
    }

    /**
     * A previously issued yes binding remains usable only while the ordered
     * patch keeps consent continuously at yes. Any intermediate no/unanswered
     * state revokes that binding; a later yes therefore needs a fresh Phase7
     * server-issued binding and is refused during Phase3.
     */
    private consentBindingRemainsValid(
        task: AgentTaskEntity,
        operations: readonly ClientInputOperation[],
    ): boolean {
        if (task.draft.consent.choice !== "yes" || task.draft.consent.binding === null) return false;
        return operations.every((operation) => {
            if (operation.op === "set" && operation.field === "automationChoice") return operation.value === "yes";
            if (operation.op === "clear" && operation.field === "automationChoice") return false;
            return true;
        });
    }

    /**
     * Compare persisted business state while ignoring only volatile metadata
     * generated for each request. Provenance source and entry existence remain
     * semantic: a model/lookup fact becoming an authoritative user fact is an
     * accepted change, while another user confirmation of the same value is a
     * no-op. Protected server mappings remain part of this comparison.
     */
    private hasSemanticDraftChange(previous: AgentTaskDraft, next: AgentTaskDraft): boolean {
        const semanticProvenance = (provenance: AgentTaskDraft["provenance"]) => ({
            confirmed: Object.fromEntries(
                Object.entries(provenance.confirmed).map(([field, value]) => [field, { source: value.source }]),
            ),
            tentative: Object.fromEntries(
                Object.entries(provenance.tentative).map(([field, value]) => [field, { source: value.source }]),
            ),
        });
        const semanticDraft = (draft: AgentTaskDraft): string => {
            const semantic = {
                ...draft,
                provenance: semanticProvenance(draft.provenance),
            } as Record<string, unknown>;
            // This reference is generated for each accepted snapshot and is
            // intentionally excluded from the business-state comparison.
            delete semantic["currentSnapshotRef"];
            return JSON.stringify(semantic);
        };
        return semanticDraft(previous) !== semanticDraft(next);
    }

    private async updateIssues(
        principal: VerifiedTenantPrincipal,
        state: ClientInputState,
        task: AgentTaskEntity | null,
        existing: AgentTaskEntity["draft"]["issues"],
        targetOverride?: {
            targetRef: string;
            targetVersion: string;
            targetClient: Awaited<ReturnType<IClientRepository["findById"]>>;
        },
    ): Promise<AgentTaskEntity["draft"]["issues"]> {
        const issues = existing.filter((issue) => !DYNAMIC_ISSUE_CODES.has(issue.code));
        const addIssue = (
            code: AgentTask["issues"][number]["code"],
            field?: AgentTask["issues"][number]["field"],
            message = "Additional task information is required",
        ) => {
            if (issues.some((issue) => issue.code === code && issue.field === field)) return;
            issues.push({ code, ...(field ? { field } : {}), severity: "error", message });
        };

        let targetStatus: "missing" | "stale" | "valid" = "missing";
        let targetClientId: number | undefined;
        if (targetOverride) {
            if (targetOverride.targetClient && clientAgentTargetVersion(targetOverride.targetClient) === targetOverride.targetVersion) {
                targetStatus = "valid";
                targetClientId = targetOverride.targetClient.id;
            } else {
                targetStatus = "stale";
            }
        } else if (task) {
            const target = task.draft.server.references.target;
            const targetRef = task.targetRef;
            const targetVersion = task.targetVersion;
            if (target && (!targetRef || !targetVersion || target.targetRef !== targetRef)) {
                targetStatus = "stale";
            } else if (target && targetRef && targetVersion) {
                let client: Awaited<ReturnType<IClientRepository["findById"]>>;
                try {
                    client = await this.clientRepository.findById(principal.branchId, target.clientId);
                } catch (error) {
                    if (error instanceof ServiceUnavailableException) throw error;
                    throw storageUnavailable();
                }
                if (client && clientAgentTargetVersion(client) === targetVersion) {
                    targetStatus = "valid";
                    targetClientId = client.id;
                } else {
                    targetStatus = "stale";
                }
            }
        }
        if (targetStatus === "missing") {
            addIssue("task.required", undefined, "A customer target is required");
        } else if (targetStatus === "stale") {
            addIssue("task.stale", undefined, "The customer target is stale");
        }

        const hasProposedChange = Object.keys(state.confirmed).length > 0 || state.clearedFields.length > 0;
        if (!hasProposedChange) addIssue("task.required", undefined);

        if (Object.prototype.hasOwnProperty.call(state.confirmed, "phone")) {
            const normalizedPhone = normalizePhone(state.confirmed.phone);
            if (!normalizedPhone) {
                addIssue("task.invalid", "phone", "A valid phone number is required");
            } else {
                const duplicateCheck = await this.duplicateCheck(
                    principal,
                    state,
                    targetStatus === "valid" ? targetClientId : undefined,
                    "update",
                );
                if (duplicateCheck.status === "duplicate") addIssue("task.duplicate", "phone");
                if (duplicateCheck.status === "failed") addIssue("task.invalid", "phone");
                if (duplicateCheck.status === "not_checked" || duplicateCheck.status === "checking") {
                    addIssue("task.invalid", "phone");
                }
            }
        }

        return issues;
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
        origin: AgentTaskMutationOrigin = "user",
        operationOrigins?: readonly AgentTaskMutationOrigin[],
    ): AgentTaskDraft["provenance"] {
        const confirmed = { ...initial.confirmed };
        const tentative = { ...initial.tentative };
        const capturedAt = new Date().toISOString();
        for (const [index, operation] of operations.entries()) {
            if (operation.op === "set" && operation.field !== "automationChoice" && operation.field !== "noSend") {
                confirmed[operation.field] = { source: originSource(operationOrigins?.[index] ?? origin), capturedAt, eventId, valueRef: randomUUID() };
                delete tentative[operation.field];
            } else if (operation.op === "mark-tentative") {
                tentative[operation.field] = { source: originSource(operationOrigins?.[index] ?? origin), capturedAt, eventId, valueRef: randomUUID() };
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
        mode: "create" | "update" = "create",
    ): Promise<ClientDuplicateCheckResult> {
        const normalizedPhone = mode === "update"
            ? normalizePhone(state.confirmed.phone)
            : normalizeClientPhone(state.confirmed.phone);
        if (!normalizedPhone || (mode === "create" && !/^\d{11}$/.test(normalizedPhone))) return { status: "not_checked" };
        try {
            await assertPhoneAvailable(this.clientRepository, principal.branchId, normalizedPhone, currentClientId);
            return {
                status: "clear",
                ...(normalizedPhone.length === 11 ? { checkedPhone: normalizedPhone } : {}),
            };
        } catch (error) {
            if (error instanceof ConflictException) {
                return { status: "duplicate", ...(normalizedPhone.length === 11 ? { checkedPhone: normalizedPhone } : {}) };
            }
            if (error instanceof BadRequestException) {
                return { status: "failed", ...(normalizedPhone.length === 11 ? { checkedPhone: normalizedPhone } : {}) };
            }
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
        if (result.status === "forbidden") throw new ForbiddenException(result.message);
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
