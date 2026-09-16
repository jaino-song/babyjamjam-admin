import { randomUUID } from "node:crypto";
import { z } from "../../backend/node_modules/zod";

import { AgentRuntimeService } from "../../backend/application/agent/agent-runtime.service";
import { AgentSessionService } from "../../backend/application/agent/agent-session.service";
import { AgentTaskPolicyService } from "../../backend/application/agent/agent-task-policy.service";
import { AgentTaskService } from "../../backend/application/agent/agent-task.service";
import { ConversationContextAssemblerService } from "../../backend/application/agent/conversation-context-assembler.service";
import { ConversationTaskOrchestratorService } from "../../backend/application/agent/conversation-task-orchestrator.service";
import { DeterministicAgentLanguageModel } from "../../backend/infrastructure/agent/deterministic-agent-language-model";
import { createEmptyAgentTaskDraft, type AgentTaskEntity, type AgentTaskEventEntity } from "../../backend/domain/entities/agent-task.entity";
import type { AgentSessionEntity, AgentSessionOwner, CreateAgentSessionInput } from "../../backend/domain/entities/agent-session.entity";
import type {
    AgentSessionPatch,
    IAgentSessionRepository,
} from "../../backend/domain/repositories/agent-session.repository.interface";
import type {
    AgentTaskEventInput,
    AgentTaskEventInsertResult,
    AgentTaskEventLookupResult,
    AgentTaskListResult,
    AgentTaskMutationResult,
    AgentTaskReadResult,
    AgentTaskRecoveryListResult,
    AgentTaskRecoveryReadResult,
    AgentTaskSessionLockResult,
    AgentTaskTaskLockResult,
    AgentTaskTransaction,
    AgentTaskTransactionResult,
    CreateAgentTaskInput,
    IAgentTaskRepository,
    UpdateAgentTaskInput,
} from "../../backend/domain/repositories/agent-task.repository.interface";
import type { ClientEntity } from "../../backend/domain/entities/client.entity";
import type { IClientRepository } from "../../backend/domain/repositories/client.repository.interface";
import type { AgentTaskOwner } from "../../backend/domain/entities/agent-task.entity";
import type { VerifiedTenantPrincipal } from "../../backend/infrastructure/tenant/tenant.context";

import type {
    ConversationRuntimeAdapter,
    ConversationRuntimeContext,
    ConversationRuntimeObservation,
    ConversationTransport,
    RuntimeSafetyError,
    RuntimeStructuredEvent,
} from "./evaluation-policy";
import type { ConversationScenario, ConversationTurn, InputEvent } from "./cases";
import { isQuestionLike, conversationMessageEventId, conversationMessageHash } from "../../backend/application/agent/conversation-task-policy";

/**
 * The product projection intentionally excludes `scenario.oracle`.  A driver
 * must obtain every observation from the product runtime, task service, and
 * its injected ledgers; fixture expectations are only consumed later by the
 * evaluator.
 */
export interface ProductScenarioProjection {
    readonly id: string;
    readonly partition: ConversationScenario["partition"];
    readonly family: ConversationScenario["family"];
    readonly fixtureVersion: ConversationScenario["fixtureVersion"];
    readonly deterministicClock: ConversationScenario["deterministicClock"];
    readonly syntheticTokens: readonly string[];
    readonly turns: readonly ConversationTurn[];
}
export interface ProductRuntimeTurnContext {
    readonly scenario: ProductScenarioProjection;
    readonly turn: ConversationTurn;
    readonly turnIndex: number;
    readonly clock: ConversationRuntimeContext["clock"];
    readonly transport: ConversationTransport;
}

/**
 * A narrow bridge around the real AgentRuntime/task service.  The adapter does
 * not prescribe how a host builds DI fixtures: the host supplies one driver
 * that sends a turn through the actual runtime and returns inspected evidence.
 * Returning a partial observation is intentional while a later lifecycle
 * phase has no authoritative ledger (the evaluator reports not_evaluated).
 */
export interface ProductRuntimeDriver {
    reset?(context: {
        readonly scenario: ProductScenarioProjection;
        readonly clock: ConversationRuntimeContext["clock"];
        readonly transport: ConversationTransport;
    }): Promise<void> | void;
    runTurn(context: ProductRuntimeTurnContext): Promise<ConversationRuntimeObservation | void>;
    inspect?(context: {
        readonly scenario: ProductScenarioProjection;
        readonly clock: ConversationRuntimeContext["clock"];
        readonly transport: ConversationTransport;
    }): Promise<ConversationRuntimeObservation | void>;
}

export interface ProductRuntimeAdapterOptions {
    readonly driver?: ProductRuntimeDriver;
    /** Bound the number of driver calls even if a malformed projection grows. */
    readonly maxTurns?: number;
}

/** Build an oracle-free immutable projection for the product bridge. */
export function projectScenarioForProduct(scenario: ConversationScenario): ProductScenarioProjection {
    return {
        id: scenario.id,
        partition: scenario.partition,
        family: scenario.family,
        fixtureVersion: scenario.fixtureVersion,
        deterministicClock: scenario.deterministicClock,
        syntheticTokens: [...scenario.syntheticTokens],
        turns: scenario.turns.map((turn) => ({
            id: turn.id,
            userText: turn.userText,
            inputEvents: turn.inputEvents.map((event) => ({ ...event } as InputEvent)),
        })),
    };
}

function mergeObservations(
    current: ConversationRuntimeObservation,
    next: ConversationRuntimeObservation | void,
): ConversationRuntimeObservation {
    if (!next) return current;
    return {
        ...current,
        ...(next.completion === undefined ? {} : { completion: next.completion }),
        ...(next.currentState === undefined ? {} : { currentState: next.currentState }),
        ...(next.acceptedDraftState === undefined ? {} : { acceptedDraftState: next.acceptedDraftState }),
        ...(next.structuredEvents === undefined ? {} : { structuredEvents: [...(current.structuredEvents ?? []), ...next.structuredEvents] }),
        ...(next.actionExecutionLedger === undefined ? {} : { actionExecutionLedger: [...(current.actionExecutionLedger ?? []), ...next.actionExecutionLedger] }),
        ...(next.sends === undefined ? {} : { sends: [...(current.sends ?? []), ...next.sends] }),
        ...(next.authorityOutcomes === undefined ? {} : { authorityOutcomes: [...(current.authorityOutcomes ?? []), ...next.authorityOutcomes] }),
        ...(next.assistantMessages === undefined ? {} : { assistantMessages: [...(current.assistantMessages ?? []), ...next.assistantMessages] }),
        ...(next.safetyErrors === undefined ? {} : { safetyErrors: [...(current.safetyErrors ?? []), ...next.safetyErrors] }),
    };
}

function applyClockEvents(turn: ConversationTurn, clock: ConversationRuntimeContext["clock"]): void {
    for (const event of turn.inputEvents) {
        if (event.type === "clock_advance") clock.advanceTo(event.at);
    }
}

function transportSafetyError(transport: ConversationTransport, observedAt: string): RuntimeSafetyError | undefined {
    // Deterministic product runs are intentionally offline. Read the injected
    // counter after all driver calls; do not trust a driver-supplied observation
    // field to claim that no network request occurred.
    if (transport.networkCalls === 0 && transport.calls === 0) return undefined;
    return {
        code: "other",
        message: `Deterministic product bridge observed ${transport.networkCalls} network calls across ${transport.calls} transport calls`,
        observedAt,
    };
}

/**
 * Connect deterministic fixtures to an actual product/runtime driver.  With
 * no driver, the adapter still returns an honest structural observation: all
 * outcome fields remain missing and the evaluator reports not_evaluated rather
 * than passing synthetic fixture state.
 */
export function createProductRuntimeAdapter(options: ProductRuntimeAdapterOptions = {}): ConversationRuntimeAdapter {
    const maxTurns = Number.isSafeInteger(options.maxTurns) && (options.maxTurns ?? 0) > 0
        ? Math.min(options.maxTurns!, 32)
        : 16;
    return {
        mode: "product",
        async run(context: ConversationRuntimeContext): Promise<ConversationRuntimeObservation> {
            const scenario = projectScenarioForProduct(context.case);
            const driver = options.driver;
            let observation: ConversationRuntimeObservation = {};
            if (!driver) {
                return {
                    transport: { networkCalls: context.transport.networkCalls, calls: context.transport.calls },
                };
            }

            await driver.reset?.({ scenario, clock: context.clock, transport: context.transport });
            const turns = scenario.turns.slice(0, maxTurns);
            for (const [turnIndex, turn] of turns.entries()) {
                applyClockEvents(turn, context.clock);
                observation = mergeObservations(observation, await driver.runTurn({
                    scenario,
                    turn,
                    turnIndex,
                    clock: context.clock,
                    transport: context.transport,
                }));
            }
            observation = mergeObservations(observation, await driver.inspect?.({
                scenario,
                clock: context.clock,
                transport: context.transport,
            }));
            const networkError = transportSafetyError(context.transport, context.clock.now);
            if (networkError) {
                observation = {
                    ...observation,
                    safetyErrors: [...(observation.safetyErrors ?? []), networkError],
                };
            }
            return {
                ...observation,
                // This is always read from the authoritative injected transport
                // after the driver has completed.
                transport: { networkCalls: context.transport.networkCalls, calls: context.transport.calls },
            };
        },
    };
}

/**
 * The product bridge uses an in-memory unit-of-work, rather than the fixture
 * oracle or a Prisma connection.  This keeps the product evaluator offline
 * while still exercising the same AgentTaskService, conversation orchestrator
 * and AgentRuntimeService code that the HTTP application wires.
 */
class ProductTransactionAbort extends Error {
    constructor(readonly result: unknown) {
        super("product transaction aborted");
    }
}

type ProductSessionMetadata = {
    sessionId: string;
    userId: string;
    branchId: string;
    expiresAt: Date;
    archivedAt: Date | null;
};

type ProductScope = { sessionId: string; userId: string; branchId: string };

type ProductTaskStatus = AgentTaskEntity["status"];

function cloneDate(value: Date): Date {
    return new Date(value.getTime());
}

function cloneTask(task: AgentTaskEntity): AgentTaskEntity {
    return {
        ...task,
        draft: structuredClone(task.draft),
        lastAcceptedAt: cloneDate(task.lastAcceptedAt),
        expiresAt: cloneDate(task.expiresAt),
        terminalAt: task.terminalAt ? cloneDate(task.terminalAt) : null,
        purgedAt: task.purgedAt ? cloneDate(task.purgedAt) : null,
        createdAt: cloneDate(task.createdAt),
        updatedAt: cloneDate(task.updatedAt),
    };
}

function cloneEvent(event: AgentTaskEventEntity): AgentTaskEventEntity {
    return { ...event, acceptedAt: cloneDate(event.acceptedAt) };
}

function activeSlotForProductStatus(status: ProductTaskStatus): number | null {
    return ["collecting", "confirming_target", "review_ready"].includes(status) ? 1 : null;
}

const PRODUCT_LIVE_TASK_STATES = new Set<ProductTaskStatus>([
    "collecting",
    "confirming_target",
    "review_ready",
    "awaiting_approval",
    "paused",
    "executing",
    "reconciling",
]);

/**
 * Keep product evidence structural.  The task entity itself contains
 * protected customer values, so every observation is made from the safe task
 * projection and never copies confirmed/tentative values into an evaluation
 * record.
 */
function safeProductTask(task: AgentTaskEntity) {
    const confirmed = new Set(Object.keys(task.draft.confirmed));
    const tentative = new Set(Object.keys(task.draft.tentative));
    const cleared = new Set(task.draft.clearedFields);
    const fields = [...new Set([...confirmed, ...tentative, ...cleared])].sort().map((field) => ({
        field,
        status: confirmed.has(field) && tentative.has(field)
            ? "confirmed-and-tentative" as const
            : confirmed.has(field)
                ? "confirmed" as const
                : tentative.has(field)
                    ? "tentative" as const
                    : "missing" as const,
    }));
    return {
        fieldStatus: fields,
        clearedFields: [...cleared],
        revision: task.revision,
        issues: task.draft.issues.map(({ code, field, severity }) => ({ code, field, severity })),
        choiceSets: task.draft.choiceSets.map(() => ({})),
        target: task.targetRef !== null && task.targetVersion !== null ? {} : null,
    };
}

function draftStatusForProductTask(status: ProductTaskStatus): "pending" | "accepted" | "rejected" {
    if (status === "completed") return "accepted";
    if (status === "failed" || status === "cancelled") return "rejected";
    return "pending";
}

function draftObservationForProductTask(task: AgentTaskEntity, observedAt: string) {
    const safe = safeProductTask(task);
    const fields: Record<string, string> = {};
    for (const field of safe.fieldStatus) {
        if (field.status !== "missing") fields[field.field] = field.status;
    }
    // A clear marker is safe structural evidence and differs from an omitted
    // field without exposing the value that was cleared.
    for (const field of safe.clearedFields) fields[field] = "cleared";
    return {
        status: draftStatusForProductTask(task.status),
        fields,
        // Revision is the stable server version.  Snapshot UUIDs and wall
        // clock values are intentionally excluded from semantic evidence.
        version: String(safe.revision),
        observedAt,
    } as const;
}

function activeProductTask(tasks: readonly AgentTaskEntity[]): AgentTaskEntity | null {
    return tasks
        .filter((task) => task.purgedAt === null && task.expiresAt.getTime() > Date.now() && PRODUCT_LIVE_TASK_STATES.has(task.status) && task.activeSlot === 1)
        .sort((left, right) => right.revision - left.revision || right.updatedAt.getTime() - left.updatedAt.getTime() || left.taskId.localeCompare(right.taskId))[0] ?? null;
}

function latestProductTask(tasks: readonly AgentTaskEntity[]): AgentTaskEntity | null {
    return tasks
        .filter((task) => task.purgedAt === null && task.expiresAt.getTime() > Date.now())
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.revision - left.revision || left.taskId.localeCompare(right.taskId))[0] ?? null;
}

function currentStateObservationForProductTasks(
    tasks: readonly AgentTaskEntity[],
    observedAt: string,
    streamCompleted: boolean,
): ConversationRuntimeObservation["currentState"] {
    const visibleTasks = tasks.filter((task) => task.purgedAt === null && task.expiresAt.getTime() > Date.now());
    const task = activeProductTask(visibleTasks) ?? latestProductTask(visibleTasks);
    if (!task) {
        return {
            phase: streamCompleted ? "answered" : "blocked",
            version: streamCompleted ? "runtime" : "runtime-error",
            facts: {
                taskCount: String(visibleTasks.length),
                runtime: streamCompleted ? "answered" : "blocked",
            },
            requiredTokens: [],
            observedAt,
        };
    }

    const safe = safeProductTask(task);
    const requiredTokens = safe.issues
        .flatMap((issue) => issue.field ? [issue.field] : [])
        .sort();
    return {
        phase: task.status,
        version: String(task.revision),
        facts: {
            capabilityId: task.capabilityId,
            taskState: task.status,
            taskRevision: String(task.revision),
            taskCount: String(visibleTasks.length),
            activeSlot: task.activeSlot === null ? "none" : String(task.activeSlot),
            target: safe.target ? "present" : "absent",
            choiceSetCount: String(safe.choiceSets.length),
            issueCount: String(safe.issues.length),
        },
        requiredTokens,
        observedAt,
    };
}

function completionForProductTask(
    task: AgentTaskEntity | null,
    streamCompleted: boolean,
): ConversationRuntimeObservation["completion"] {
    if (!streamCompleted) return "blocked";
    if (!task) return "completed";
    if (task.status === "completed") return "completed";
    if (task.status === "failed" || task.status === "cancelled") return "blocked";
    return "awaiting_user";
}

function structuredEventType(operation: string, turnText: string): RuntimeStructuredEvent["type"] | undefined {
    if (operation === "create") return "draft_requested";
    if (operation === "patch") return "correction_applied";
    if (operation === "conversation:intake") return isQuestionLike(turnText) ? "question_asked" : "fact_observed";
    if (operation.startsWith("choices:") && operation.endsWith(":empty")) return "result_unknown";
    if (operation.startsWith("choices:")) return "target_choice_required";
    if (operation === "command:select-target") return "fact_observed";
    if (operation.startsWith("command:")) return "checkpoint_reloaded";
    return undefined;
}

function structuredObservationsForEvents(
    events: readonly AgentTaskEventEntity[],
    turnText: string,
    observedAt: string,
): ConversationRuntimeObservation["structuredEvents"] {
    return events.flatMap((event) => {
        const type = structuredEventType(event.operation, turnText);
        return type ? [{ type, value: event.operation, observedAt }] : [];
    });
}

function textFromStreamChunk(chunk: unknown): string {
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) return "";
    const value = chunk as Record<string, unknown>;
    if (value["type"] === "text-delta" && typeof value["delta"] === "string") return value["delta"];
    if (value["type"] === "text" && typeof value["text"] === "string") return value["text"];
    return "";
}

function textFromPersistedAssistant(message: unknown): string {
    if (!message || typeof message !== "object" || Array.isArray(message)) return "";
    const parts = (message as Record<string, unknown>)["parts"];
    if (!Array.isArray(parts)) return "";
    return parts.flatMap((part) => {
        if (!part || typeof part !== "object" || Array.isArray(part)) return [];
        const value = part as Record<string, unknown>;
        return value["type"] === "text" && typeof value["text"] === "string" ? [value["text"]] : [];
    }).join("");
}

function productTaskTombstone(task: AgentTaskEntity) {
    return {
        taskId: task.taskId,
        sessionId: task.sessionId,
        userId: task.userId,
        branchId: task.branchId,
        expiresAt: cloneDate(task.expiresAt),
        purgedAt: task.purgedAt ? cloneDate(task.purgedAt) : null,
    };
}

function productEventReceipt(event: AgentTaskEventEntity, task: AgentTaskEntity) {
    return {
        serverEventId: event.id,
        eventId: event.clientEventId,
        taskId: event.taskId,
        requestHash: event.requestHash,
        operation: event.operation,
        acceptedRevision: event.acceptedRevision,
        resultActionId: event.resultActionId,
        acceptedAt: cloneDate(event.acceptedAt),
        currentSnapshotRef: task.draft.currentSnapshotRef,
    };
}

/**
 * Small real repository port for deterministic product observations.  It is
 * deliberately stateful and revision-aware: service replay, CAS conflicts,
 * retention and event receipts all go through the repository transaction
 * methods instead of being asserted from fixture expectations.
 */
export class DeterministicProductTaskRepository implements IAgentTaskRepository {
    readonly tasks = new Map<string, AgentTaskEntity>();
    readonly events = new Map<string, AgentTaskEventEntity>();
    readonly sessions = new Map<string, ProductSessionMetadata>();

    registerSession(session: ProductSessionMetadata): void {
        this.sessions.set(session.sessionId, { ...session, expiresAt: cloneDate(session.expiresAt) });
    }

    updateSession(session: ProductSessionMetadata): void {
        this.registerSession(session);
    }

    clear(): void {
        this.tasks.clear();
        this.events.clear();
        this.sessions.clear();
    }

    snapshotTasks(scope?: ProductScope): AgentTaskEntity[] {
        return [...this.tasks.values()]
            .filter((task) => !scope || (
                task.sessionId === scope.sessionId
                && task.userId === scope.userId
                && task.branchId === scope.branchId
            ))
            .map(cloneTask);
    }

    snapshotEvents(scope?: ProductScope): AgentTaskEventEntity[] {
        return [...this.events.values()]
            .filter((event) => !scope || (
                event.sessionId === scope.sessionId
                && event.userId === scope.userId
                && event.branchId === scope.branchId
            ))
            .map(cloneEvent);
    }

    private sessionFor(scope: ProductScope): ProductSessionMetadata | null {
        const session = this.sessions.get(scope.sessionId);
        if (!session || session.userId !== scope.userId || session.branchId !== scope.branchId) return null;
        return session;
    }

    private readTask(taskId: string, scope: ProductScope): AgentTaskReadResult {
        const task = this.tasks.get(taskId);
        if (!task || task.sessionId !== scope.sessionId || task.userId !== scope.userId || task.branchId !== scope.branchId) {
            return { status: "not_found" };
        }
        if (task.purgedAt) return { status: "task_purged", tombstone: productTaskTombstone(task) };
        if (task.expiresAt <= new Date()) return { status: "task_expired", tombstone: productTaskTombstone(task), task: cloneTask(task) };
        return { status: "found", task: cloneTask(task) };
    }

    async findOwned(taskId: string, owner: AgentTaskOwner): Promise<AgentTaskReadResult> {
        const task = this.tasks.get(taskId);
        if (!task || task.userId !== owner.userId || task.branchId !== owner.branchId) return { status: "not_found" };
        const session = this.sessions.get(task.sessionId);
        if (!session || session.userId !== owner.userId || session.branchId !== owner.branchId) return { status: "not_found" };
        if (session.archivedAt) return { status: "session_archived", session };
        if (session.expiresAt <= new Date()) return { status: "session_expired", session };
        return this.readTask(taskId, { ...owner, sessionId: task.sessionId });
    }

    async findOwnedRecovery(taskId: string, owner: AgentTaskOwner): Promise<AgentTaskRecoveryReadResult> {
        const task = this.tasks.get(taskId);
        return task && task.userId === owner.userId && task.branchId === owner.branchId && task.activeActionId !== null
            ? { status: "found", task: cloneTask(task) }
            : { status: "not_found" };
    }

    async listOwned(scope: ProductScope): Promise<AgentTaskListResult> {
        const session = this.sessionFor(scope);
        if (!session) return { status: "not_found" };
        if (session.archivedAt) return { status: "session_archived", session };
        if (session.expiresAt <= new Date()) return { status: "session_expired", session };
        return { status: "found", tasks: this.snapshotTasks(scope) };
    }

    async listOwnedRecovery(scope: ProductScope): Promise<AgentTaskRecoveryListResult> {
        const session = this.sessionFor(scope);
        if (!session) return { status: "not_found" };
        return {
            status: "found",
            taskIds: this.snapshotTasks(scope)
                .filter((task) => task.activeActionId !== null)
                .map((task) => task.taskId)
                .sort(),
        };
    }

    async withTransaction<T>(
        scope: ProductScope,
        operation: (transaction: AgentTaskTransaction) => Promise<T>,
    ): Promise<AgentTaskTransactionResult<T>> {
        const taskSnapshot = new Map([...this.tasks.entries()].map(([id, task]) => [id, cloneTask(task)]));
        const eventSnapshot = new Map([...this.events.entries()].map(([id, event]) => [id, cloneEvent(event)]));
        const sessionSnapshot = new Map([...this.sessions.entries()].map(([id, session]) => [id, { ...session, expiresAt: cloneDate(session.expiresAt) }]));
        try {
            const value = await operation(this.transaction(scope));
            return { status: "ok", value };
        } catch (error) {
            if (error instanceof ProductTransactionAbort) {
                this.tasks.clear();
                for (const [id, task] of taskSnapshot) this.tasks.set(id, task);
                this.events.clear();
                for (const [id, event] of eventSnapshot) this.events.set(id, event);
                this.sessions.clear();
                for (const [id, session] of sessionSnapshot) this.sessions.set(id, session);
                return { status: "aborted", value: error.result as T };
            }
            this.tasks.clear();
            for (const [id, task] of taskSnapshot) this.tasks.set(id, task);
            this.events.clear();
            for (const [id, event] of eventSnapshot) this.events.set(id, event);
            this.sessions.clear();
            for (const [id, session] of sessionSnapshot) this.sessions.set(id, session);
            return { status: "storage_failure" };
        }
    }

    async createWithEvent(
        scope: ProductScope,
        input: CreateAgentTaskInput,
        eventInput: AgentTaskEventInput,
    ): Promise<AgentTaskMutationResult> {
        const result = await this.withTransaction(scope, async (transaction): Promise<AgentTaskMutationResult> => {
            const session = await transaction.lockSession();
            if (session.status !== "locked") return session.status === "session_archived" || session.status === "session_expired" ? session : { status: "not_found" };
            const existing = await transaction.findEvent(eventInput.clientEventId);
            if (existing.status === "found") {
                if (existing.event.requestHash !== eventInput.requestHash) return { status: "event_hash_conflict", event: existing.event };
                const current = await transaction.readTask(existing.event.taskId);
                if (current.status === "found" || current.status === "task_expired") {
                    return { status: "event_replay", task: current.task, receipt: productEventReceipt(existing.event, current.task) };
                }
                return current.status === "task_purged" ? current : { status: "storage_failure" };
            }
            const retained = await transaction.ensureSessionRetention(input.expiresAt);
            if (retained.status === "storage_failure") return transaction.abort<AgentTaskMutationResult>({ status: "storage_failure" });
            const created = await transaction.createTask(input);
            if (created.status !== "created") return created;
            const inserted = await transaction.insertEvent(eventInput);
            if (inserted.status !== "inserted") return transaction.abort<AgentTaskMutationResult>({ status: "storage_failure" });
            return { status: "created", task: created.task, receipt: productEventReceipt(inserted.event, created.task) };
        });
        return result.status === "ok" || result.status === "aborted" ? result.value : result;
    }

    async updateWithEvent(
        scope: ProductScope,
        taskId: string,
        input: UpdateAgentTaskInput,
        eventInput: AgentTaskEventInput,
    ): Promise<AgentTaskMutationResult> {
        const result = await this.withTransaction(scope, async (transaction): Promise<AgentTaskMutationResult> => {
            const session = await transaction.lockSession();
            if (session.status !== "locked") return session.status === "session_archived" || session.status === "session_expired" ? session : { status: "not_found" };
            const locked = await transaction.lockTask(taskId);
            if (locked.status === "not_found" || locked.status === "storage_failure") return locked;
            const existing = await transaction.findEvent(eventInput.clientEventId);
            if (existing.status === "found") {
                if (existing.event.requestHash !== eventInput.requestHash) return { status: "event_hash_conflict", event: existing.event };
                if (locked.status === "task_purged") return locked;
                return { status: "event_replay", task: locked.task, receipt: productEventReceipt(existing.event, locked.task) };
            }
            if (locked.status === "task_expired" || locked.status === "task_purged") return locked;
            const updated = await transaction.updateTask(input);
            if (updated.status !== "updated") return updated;
            const inserted = await transaction.insertEvent(eventInput);
            if (inserted.status !== "inserted") return transaction.abort<AgentTaskMutationResult>({ status: "storage_failure" });
            return { status: "updated", task: updated.task, receipt: productEventReceipt(inserted.event, updated.task) };
        });
        return result.status === "ok" || result.status === "aborted" ? result.value : result;
    }

    async purgeExpired(now: Date): Promise<number> {
        let purged = 0;
        for (const task of this.tasks.values()) {
            if (task.purgedAt || task.expiresAt > now || ["awaiting_approval", "executing", "reconciling"].includes(task.status)) continue;
            task.draft = createEmptyAgentTaskDraft(randomUUID());
            task.activeSlot = null;
            task.targetRef = null;
            task.targetVersion = null;
            task.purgedAt = cloneDate(now);
            task.updatedAt = cloneDate(now);
            purged += 1;
        }
        return purged;
    }

    private transaction(scope: ProductScope): AgentTaskTransaction {
        let lockedTask: AgentTaskEntity | null = null;
        let lockedSession: ProductSessionMetadata | null = null;
        const eventKey = (clientEventId: string) => `${scope.sessionId}:${scope.userId}:${scope.branchId}:${clientEventId}`;
        return {
            lockSession: async (): Promise<AgentTaskSessionLockResult> => {
                const session = this.sessionFor(scope);
                if (!session) return { status: "not_found" };
                lockedSession = session;
                if (session.archivedAt) return { status: "session_archived", session };
                if (session.expiresAt <= new Date()) return { status: "session_expired", session };
                return { status: "locked", session };
            },
            ensureSessionRetention: async (minExpiry: Date) => {
                if (!lockedSession) return { status: "storage_failure" } as const;
                if (minExpiry.getTime() <= lockedSession.expiresAt.getTime()) return { status: "unchanged", expiresAt: cloneDate(lockedSession.expiresAt) } as const;
                lockedSession.expiresAt = cloneDate(minExpiry);
                this.updateSession(lockedSession);
                return { status: "extended", expiresAt: cloneDate(minExpiry) } as const;
            },
            lockTask: async (taskId: string): Promise<AgentTaskTaskLockResult> => {
                const result = this.readTask(taskId, scope);
                if (result.status === "found") {
                    lockedTask = this.tasks.get(taskId) ?? null;
                    return { status: "locked", task: cloneTask(result.task) };
                }
                if (result.status === "task_expired") {
                    lockedTask = this.tasks.get(taskId) ?? null;
                    return { status: "task_expired", task: cloneTask(result.task), tombstone: result.tombstone };
                }
                if (result.status === "task_purged") return result;
                return result.status === "storage_failure" ? result : { status: "not_found" };
            },
            findEvent: async (clientEventId: string): Promise<AgentTaskEventLookupResult> => {
                const event = this.events.get(eventKey(clientEventId));
                return event ? { status: "found", event: cloneEvent(event) } : { status: "not_found" };
            },
            createTask: async (input: CreateAgentTaskInput) => {
                if (!lockedSession) return { status: "not_found" } as const;
                const active = [...this.tasks.values()].some((task) => (
                    task.sessionId === scope.sessionId
                    && task.userId === scope.userId
                    && task.branchId === scope.branchId
                    && task.activeSlot === 1
                ));
                if (active) return { status: "active_task_conflict" } as const;
                const now = new Date();
                const task: AgentTaskEntity = {
                    taskId: input.taskId,
                    sessionId: scope.sessionId,
                    userId: scope.userId,
                    branchId: scope.branchId,
                    capabilityId: input.capabilityId,
                    schemaVersion: input.schemaVersion ?? 1,
                    revision: input.revision ?? 1,
                    status: input.status ?? "collecting",
                    activeSlot: activeSlotForProductStatus(input.status ?? "collecting"),
                    draft: structuredClone(input.draft),
                    targetRef: input.targetRef === undefined ? null : input.targetRef,
                    targetVersion: input.targetVersion ?? null,
                    activeActionId: input.activeActionId ?? null,
                    lastAcceptedAt: cloneDate(input.lastAcceptedAt ?? now),
                    expiresAt: cloneDate(input.expiresAt),
                    terminalAt: input.terminalAt ? cloneDate(input.terminalAt) : null,
                    purgedAt: input.purgedAt ? cloneDate(input.purgedAt) : null,
                    createdAt: now,
                    updatedAt: now,
                };
                this.tasks.set(task.taskId, task);
                lockedTask = task;
                return { status: "created", task: cloneTask(task) } as const;
            },
            updateTask: async (input: UpdateAgentTaskInput) => {
                if (!lockedTask) return { status: "not_found" } as const;
                const current = this.tasks.get(lockedTask.taskId);
                if (!current) return { status: "not_found" } as const;
                if (current.purgedAt) return { status: "task_purged", tombstone: productTaskTombstone(current) } as const;
                if (current.expiresAt <= new Date()) return { status: "task_expired", task: cloneTask(current) } as const;
                if (current.revision !== input.expectedRevision) return { status: "stale_revision", currentTask: cloneTask(current) } as const;
                const nextStatus = input.status ?? current.status;
                current.revision += 1;
                current.status = nextStatus;
                current.activeSlot = activeSlotForProductStatus(nextStatus);
                current.lastAcceptedAt = input.preserveLastAcceptedAt ? current.lastAcceptedAt : cloneDate(input.acceptedAt ?? new Date());
                if (input.draft !== undefined) current.draft = structuredClone(input.draft);
                if (input.targetRef !== undefined) current.targetRef = input.targetRef;
                if (input.targetVersion !== undefined) current.targetVersion = input.targetVersion;
                if (input.activeActionId !== undefined) current.activeActionId = input.activeActionId;
                if (input.expiresAt !== undefined) current.expiresAt = cloneDate(input.expiresAt);
                if (input.terminalAt !== undefined) current.terminalAt = input.terminalAt ? cloneDate(input.terminalAt) : null;
                if (input.purgedAt !== undefined) current.purgedAt = input.purgedAt ? cloneDate(input.purgedAt) : null;
                current.updatedAt = new Date();
                lockedTask = current;
                return { status: "updated", task: cloneTask(current) } as const;
            },
            insertEvent: async (input: AgentTaskEventInput): Promise<AgentTaskEventInsertResult> => {
                if (!lockedTask || !lockedSession) return { status: "storage_failure" };
                const key = eventKey(input.clientEventId);
                const existing = this.events.get(key);
                if (existing) return existing.requestHash === input.requestHash ? { status: "event_hash_conflict" } : { status: "event_hash_conflict" };
                const event: AgentTaskEventEntity = {
                    id: randomUUID(),
                    sessionId: scope.sessionId,
                    userId: scope.userId,
                    branchId: scope.branchId,
                    clientEventId: input.clientEventId,
                    taskId: lockedTask.taskId,
                    operation: input.operation,
                    requestHash: input.requestHash,
                    acceptedRevision: input.acceptedRevision,
                    resultActionId: input.resultActionId ?? null,
                    acceptedAt: cloneDate(input.acceptedAt ?? new Date()),
                };
                this.events.set(key, event);
                return { status: "inserted", event: cloneEvent(event) };
            },
            readTask: async (taskId: string) => this.readTask(taskId, scope),
            abort: <T>(result: T): never => { throw new ProductTransactionAbort(result); },
        };
    }
}

class DeterministicProductSessionRepository implements IAgentSessionRepository {
    readonly sessions = new Map<string, AgentSessionEntity>();

    constructor(private readonly tasks: DeterministicProductTaskRepository) {}

    clear(): void {
        this.sessions.clear();
    }

    async create(input: CreateAgentSessionInput): Promise<AgentSessionEntity> {
        const now = new Date();
        const session: AgentSessionEntity = {
            id: randomUUID(),
            userId: input.userId,
            branchId: input.branchId,
            locale: input.locale,
            title: input.title ?? null,
            summary: null,
            selectedEntities: {},
            model: input.model,
            agentVersion: input.agentVersion,
            createdAt: now,
            updatedAt: now,
            expiresAt: cloneDate(input.expiresAt),
            archivedAt: null,
            messages: [],
        };
        this.sessions.set(session.id, session);
        this.tasks.registerSession({ sessionId: session.id, userId: session.userId, branchId: session.branchId, expiresAt: session.expiresAt, archivedAt: null });
        return session;
    }

    async list(owner: AgentSessionOwner) {
        return [...this.sessions.values()]
            .filter((session) => session.userId === owner.userId && session.branchId === owner.branchId && !session.archivedAt && session.expiresAt > new Date())
            .map((session) => {
                const { messages, selectedEntities, summary, ...rest } = session;
                void messages;
                void selectedEntities;
                void summary;
                return rest;
            });
    }

    async findOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionEntity | null> {
        const session = this.sessions.get(id);
        if (!session || session.userId !== owner.userId || session.branchId !== owner.branchId || session.archivedAt || session.expiresAt <= new Date()) return null;
        return session;
    }

    async findOwnedForRestore(id: string, owner: AgentSessionOwner): Promise<AgentSessionEntity | null> {
        const session = this.sessions.get(id);
        return session && session.userId === owner.userId && session.branchId === owner.branchId ? session : null;
    }

    async updateOwned(id: string, owner: AgentSessionOwner, patch: AgentSessionPatch): Promise<AgentSessionEntity | null> {
        const session = await this.findOwned(id, owner);
        if (!session) return null;
        Object.assign(session, patch, { updatedAt: new Date() });
        this.tasks.updateSession({ sessionId: session.id, userId: session.userId, branchId: session.branchId, expiresAt: session.expiresAt, archivedAt: session.archivedAt });
        return session;
    }

    async archiveOwned(id: string, owner: AgentSessionOwner, archivedAt: Date) {
        const session = await this.findOwnedForRestore(id, owner);
        if (!session) return "not_found" as const;
        session.archivedAt = cloneDate(archivedAt);
        this.tasks.updateSession({ sessionId: session.id, userId: session.userId, branchId: session.branchId, expiresAt: session.expiresAt, archivedAt: session.archivedAt });
        return "archived" as const;
    }

    async unarchiveOwned(id: string, owner: AgentSessionOwner) {
        const session = await this.findOwnedForRestore(id, owner);
        if (!session) return "not_found" as const;
        session.archivedAt = null;
        this.tasks.updateSession({ sessionId: session.id, userId: session.userId, branchId: session.branchId, expiresAt: session.expiresAt, archivedAt: null });
        return "unarchived" as const;
    }

    async deleteOwned(id: string, owner: AgentSessionOwner) {
        const session = await this.findOwnedForRestore(id, owner);
        if (!session) return "not_found" as const;
        this.sessions.delete(id);
        this.tasks.sessions.delete(id);
        return "deleted" as const;
    }

    async appendMessages(id: string, owner: AgentSessionOwner, messages: Parameters<IAgentSessionRepository["appendMessages"]>[2]) {
        const session = await this.findOwned(id, owner);
        if (!session) return false;
        session.messages.push(...messages.map((message) => structuredClone(message)));
        session.updatedAt = new Date();
        return true;
    }

    async upsertActionResultMessage(id: string, owner: AgentSessionOwner, message: Parameters<IAgentSessionRepository["upsertActionResultMessage"]>[2]) {
        const session = await this.findOwned(id, owner);
        if (!session) return false;
        const index = session.messages.findIndex((candidate) => candidate.id === message.id);
        if (index >= 0) session.messages[index] = structuredClone(message);
        else session.messages.push(structuredClone(message));
        session.updatedAt = new Date();
        return true;
    }

    async deleteExpired(now: Date): Promise<number> {
        let deleted = 0;
        for (const [id, session] of this.sessions) {
            if (session.expiresAt <= now) {
                this.sessions.delete(id);
                this.tasks.sessions.delete(id);
                deleted += 1;
            }
        }
        return deleted;
    }
}

class DeterministicProductClientRepository implements IClientRepository {
    async findById(): Promise<ClientEntity | null> { return null; }
    async findByIdForUpdate(): Promise<ClientEntity | null> { return null; }
    async findAll(): Promise<ClientEntity[]> { return []; }
    async findAllPaginated() { return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }; }
    async create(_branchId: string, client: ClientEntity): Promise<ClientEntity> { return client; }
    async createWithInitialSchedule(_branchId: string, client: ClientEntity) { return { client, scheduleId: 0 }; }
    async update(_branchId: string, client: ClientEntity): Promise<ClientEntity> { return client; }
    async updateServiceStatusIfCurrent() { return "stale" as const; }
    async updateIfTargetVersion(): Promise<ClientEntity | null> { return null; }
    async delete(): Promise<void> { return undefined; }
    async findByStartDate(): Promise<ClientEntity[]> { return []; }
    async findByEndDate(): Promise<ClientEntity[]> { return []; }
    async findByCreatedDate(): Promise<ClientEntity[]> { return []; }
    async findStartingWithinDays(): Promise<ClientEntity[]> { return []; }
    async findEndingWithinDays(): Promise<ClientEntity[]> { return []; }
    async findWithIncompleteContractsStartingWithinDays(): Promise<ClientEntity[]> { return []; }
    async findWithoutContractSentStartingWithinDays(): Promise<ClientEntity[]> { return []; }
    async findByPhone(): Promise<ClientEntity | null> { return null; }
}

type ProductCapabilityDefinition = {
    meta: {
        name: "clients.create" | "clients.update" | "clients.search" | "clients.get";
        domain: "clients";
        version: string;
        description: string;
        risk: "read" | "reversible-write";
        requiredRoles: string[];
        renderer: "activity" | "action-proposal";
        flagKey: string;
        sideEffect: boolean;
        approvalPolicy?: "structured";
        idempotencyPolicy?: "action-id";
    };
    inputSchema: z.ZodType;
    outputSchema: z.ZodType;
    execute: (...args: never[]) => Promise<unknown>;
};

function productCapability(name: ProductCapabilityDefinition["meta"]["name"]): ProductCapabilityDefinition {
    if (name === "clients.search") {
        return {
            meta: { name, domain: "clients", version: "1.0.0", description: "Search clients", risk: "read", requiredRoles: ["owner", "admin", "manager"], renderer: "activity", flagKey: "agent.capability.clients.search", sideEffect: false },
            inputSchema: z.object({ query: z.string().optional() }),
            outputSchema: z.object({ kind: z.literal("choices"), prompt: z.string(), choices: z.array(z.object({ id: z.union([z.string(), z.number()]), name: z.string() })) }),
            execute: async () => ({ kind: "choices", prompt: "조회 가능한 고객이 없습니다.", choices: [] }),
        };
    }
    if (name === "clients.get") {
        return {
            meta: { name, domain: "clients", version: "1.0.0", description: "Get client", risk: "read", requiredRoles: ["owner", "admin", "manager"], renderer: "activity", flagKey: "agent.capability.clients.get", sideEffect: false },
            inputSchema: z.object({ id: z.union([z.string(), z.number()]).optional() }),
            outputSchema: z.object({ kind: z.literal("entity"), entity: z.object({ id: z.union([z.string(), z.number()]), name: z.string() }) }),
            execute: async () => ({ kind: "entity", entity: { id: "product-reference", name: "조회 결과" } }),
        };
    }
    return {
        meta: { name, domain: "clients", version: "1.0.0", description: `${name} task`, risk: "reversible-write", requiredRoles: ["owner", "admin", "manager"], renderer: "action-proposal", flagKey: `agent.capability.${name}`, sideEffect: true, approvalPolicy: "structured", idempotencyPolicy: "action-id" },
        inputSchema: z.object({}),
        outputSchema: z.object({ kind: z.literal("task") }),
        execute: async () => { throw new Error("Product bridge must never execute a legacy client write"); },
    };
}

export interface DeterministicProductRuntimeEvidence {
    readonly runtimeInvocations: number;
    readonly modelInvocations: number;
    readonly taskServiceReads: number;
    readonly acceptedTaskIds: readonly string[];
    readonly eventCount: number;
    readonly replayedMessageIds: readonly string[];
    readonly runtimeErrors: readonly string[];
    readonly runtimeRestarts: number;
}

const PRODUCT_PRINCIPAL: VerifiedTenantPrincipal = {
    userId: "f1000000-0000-4000-8000-000000000001",
    branchId: "f2000000-0000-4000-8000-000000000001",
    globalRole: "admin",
    branchRole: "manager",
};

/**
 * Deterministic, oracle-free host used by the explicit product evaluator mode.
 * Each turn goes through AgentRuntimeService.stream; task state and replay
 * evidence are read from the in-memory task repository after the stream.
 */
export class DeterministicProductRuntimeHost implements ProductRuntimeDriver {
    readonly taskRepository = new DeterministicProductTaskRepository();
    readonly sessionRepository = new DeterministicProductSessionRepository(this.taskRepository);
    readonly taskService: AgentTaskService;
    runtimeService: AgentRuntimeService;
    readonly principal = PRODUCT_PRINCIPAL;

    private sessionService!: AgentSessionService;
    private readonly buildRuntimeService: () => AgentRuntimeService;
    private sessionId: string | null = null;
    private runtimeInvocations = 0;
    private modelInvocations = 0;
    private taskServiceReads = 0;
    private readonly replayedMessageIds = new Set<string>();
    private readonly runtimeErrors: string[] = [];
    private runtimeRestarts = 0;
    private lastStreamCompleted = false;

    constructor() {
        const capabilities = (["clients.create", "clients.update", "clients.search", "clients.get"] as const).map(productCapability);
        const registry = {
            list: () => capabilities,
            get: (name: string) => capabilities.find((capability) => capability.meta.name === name) ?? (() => { throw new Error(`Unknown product capability ${name}`); })(),
        };
        const config = {
            get: <T>(key: string): T | undefined => {
                void key;
                return undefined;
            },
        };
        const flags = {
            getSnapshot: async () => ({
                config: {
                    enabled: true,
                    rolloutStage: "development" as const,
                    domains: {},
                    capabilities: { "conversation.tasks": true },
                    risks: { read: true, "reversible-write": true, "irreversible-write": true, "external-side-effect": false, "paid-action": false, "privileged-administration": false },
                    branchAllowlist: [],
                    userAllowlist: [],
                },
                emergencyDisabled: false,
            }),
            isCapabilityEnabled: async () => true,
            isCapabilityEnabledFromSnapshot: () => true,
        };
        const policy = new AgentTaskPolicyService(flags as never, registry as never);
        this.taskService = new AgentTaskService(this.taskRepository, policy, new DeterministicProductClientRepository());
        const modelFactory = {
            modelId: "deterministic-product-v1",
            create: () => {
                this.modelInvocations += 1;
                return new DeterministicAgentLanguageModel([{ type: "text", text: "결정론적 제품 런타임 응답" }]);
            },
        };
        const router = {
            route: async () => ({ domains: ["clients"], capabilities }),
        };
        const traces = {
            start: async () => ({ id: randomUUID(), startedAt: Date.now(), userId: this.principal.userId, branchId: this.principal.branchId }),
            finish: async () => undefined,
        };
        this.buildRuntimeService = () => {
            // AgentRuntimeService and its task orchestrator are process-local
            // collaborators. Recreate them on a host restart while retaining
            // the repository/session maps that hold durable evidence.
            this.sessionService = new AgentSessionService(
                this.sessionRepository,
                config as never,
                { holdsLease: () => true } as never,
                this.taskRepository,
            );
            const orchestrator = new ConversationTaskOrchestratorService(this.taskService, policy);
            const contextAssembler = new ConversationContextAssemblerService(this.taskService);
            return new AgentRuntimeService(
                registry as never,
                flags as never,
                this.sessionService,
                modelFactory as never,
                router as never,
                traces as never,
                undefined,
                undefined,
                contextAssembler,
                orchestrator,
            );
        };
        this.runtimeService = this.buildRuntimeService();
    }

    /** Simulate a process restart without deleting durable task/session state. */
    restart(): void {
        this.runtimeService = this.buildRuntimeService();
        this.runtimeRestarts += 1;
        this.lastStreamCompleted = false;
    }

    /** Alias used by restart-oriented product tests. */
    restartProcess(): void {
        this.restart();
    }

    getEvidence(): DeterministicProductRuntimeEvidence {
        return {
            runtimeInvocations: this.runtimeInvocations,
            modelInvocations: this.modelInvocations,
            taskServiceReads: this.taskServiceReads,
            acceptedTaskIds: this.taskRepository.snapshotTasks({ ...this.principal, sessionId: this.sessionId ?? "" }).filter((task) => task.purgedAt === null && task.expiresAt.getTime() > Date.now()).map((task) => task.taskId),
            eventCount: this.taskRepository.snapshotEvents(this.sessionId ? { ...this.principal, sessionId: this.sessionId } : undefined).length,
            replayedMessageIds: [...this.replayedMessageIds],
            runtimeErrors: [...this.runtimeErrors],
            runtimeRestarts: this.runtimeRestarts,
        };
    }

    async reset(context?: Parameters<NonNullable<ProductRuntimeDriver["reset"]>>[0]): Promise<void> {
        void context;
        this.taskRepository.clear();
        this.sessionRepository.clear();
        this.sessionId = (await this.sessionService.create(this.principal, "ko", "deterministic-product-v1", "conversation-product-v1")).id;
        this.runtimeInvocations = 0;
        this.modelInvocations = 0;
        this.taskServiceReads = 0;
        this.replayedMessageIds.clear();
        this.runtimeErrors.length = 0;
        this.runtimeRestarts = 0;
        this.lastStreamCompleted = false;
        // Reset starts a fresh deterministic session; construct the runtime
        // against that session service before the first turn.
        this.runtimeService = this.buildRuntimeService();
    }

    async runTurn(context: ProductRuntimeTurnContext): Promise<ConversationRuntimeObservation | void> {
        const messageEvent = context.turn.inputEvents.find((event): event is Extract<InputEvent, { type: "user_message" }> => event.type === "user_message");
        if (!messageEvent || !this.sessionId) return undefined;
        this.runtimeInvocations += 1;
        if (context.turn.inputEvents.some((event) => event.type === "reload")) this.restart();
        const scope = { ...this.principal, sessionId: this.sessionId };
        const intakeEventId = conversationMessageEventId({
            userId: this.principal.userId,
            branchId: this.principal.branchId,
            sessionId: this.sessionId,
            messageId: context.turn.id,
        });
        const requestHash = conversationMessageHash({
            userId: this.principal.userId,
            branchId: this.principal.branchId,
            sessionId: this.sessionId,
            messageId: context.turn.id,
            text: messageEvent.text,
        });
        const beforeEvents = this.taskRepository.snapshotEvents(scope);
        const beforeEventIds = new Set(beforeEvents.map((event) => event.id));
        const priorIntake = beforeEvents.find((event) => event.clientEventId === intakeEventId);
        const replayAttempt = priorIntake?.requestHash === requestHash;
        const observedAt = context.clock.now;
        try {
            const streamResult = await this.runtimeService.stream({
                principal: this.principal,
                sessionId: this.sessionId,
                locale: "ko",
                messages: [{ id: context.turn.id, role: "user", parts: [{ type: "text", text: messageEvent.text }] }] as never,
            });
            const reader = streamResult.stream.getReader();
            const chunks: unknown[] = [];
            while (true) {
                const next = await reader.read();
                if (next.done) break;
                chunks.push(next.value);
                // Drain the actual UI stream so the runtime's onFinish persists
                // its assistant message and finalizes the trace.
            }
            this.taskServiceReads += 1;
            await this.taskService.listForConversation(this.principal, this.sessionId);
            const tasks = this.taskRepository.snapshotTasks(scope);
            const afterEvents = this.taskRepository.snapshotEvents(scope);
            const acceptedEvents = afterEvents.filter((event) => !beforeEventIds.has(event.id));
            const session = this.sessionRepository.sessions.get(this.sessionId);
            const persistedAssistant = [...(session?.messages ?? [])]
                .reverse()
                .find((message) => message.role === "assistant");
            const streamedText = chunks.map(textFromStreamChunk).join("");
            const assistantText = streamedText || textFromPersistedAssistant(persistedAssistant);
            if (replayAttempt) this.replayedMessageIds.add(context.turn.id);
            this.lastStreamCompleted = true;
            const task = activeProductTask(tasks) ?? latestProductTask(tasks);
            return {
                completion: completionForProductTask(task, true),
                currentState: currentStateObservationForProductTasks(tasks, observedAt, true),
                acceptedDraftState: task ? draftObservationForProductTask(task, observedAt) : null,
                structuredEvents: structuredObservationsForEvents(acceptedEvents, messageEvent.text, observedAt),
                ...(assistantText ? { assistantMessages: [{ turnId: context.turn.id, text: assistantText }] } : {}),
            };
        } catch (error) {
            // Preserve only a bounded error class in evidence. Runtime text is
            // read from the real stream/persisted message on success and is
            // never replaced with adapter-authored prose on failure.
            const errorCode = error instanceof Error ? error.name : "UnknownError";
            this.runtimeErrors.push(errorCode);
            this.lastStreamCompleted = false;
            const tasks = this.taskRepository.snapshotTasks(scope);
            const afterEvents = this.taskRepository.snapshotEvents(scope);
            const acceptedEvents = afterEvents.filter((event) => !beforeEventIds.has(event.id));
            const task = activeProductTask(tasks) ?? latestProductTask(tasks);
            return {
                completion: completionForProductTask(task, false),
                currentState: currentStateObservationForProductTasks(tasks, observedAt, false),
                acceptedDraftState: task ? draftObservationForProductTask(task, observedAt) : null,
                structuredEvents: structuredObservationsForEvents(acceptedEvents, messageEvent.text, observedAt),
                safetyErrors: [{ code: "other", message: `Product runtime failed with ${errorCode}`, observedAt }],
            };
        }
    }

    async inspect(context: {
        readonly scenario: ProductScenarioProjection;
        readonly clock: ConversationRuntimeContext["clock"];
        readonly transport: ConversationTransport;
    }): Promise<ConversationRuntimeObservation | void> {
        if (!this.sessionId) return undefined;
        this.taskServiceReads += 1;
        await this.taskService.listForConversation(this.principal, this.sessionId);
        const scope = { ...this.principal, sessionId: this.sessionId };
        const tasks = this.taskRepository.snapshotTasks(scope);
        const task = activeProductTask(tasks) ?? latestProductTask(tasks);
        return {
            completion: completionForProductTask(task, this.lastStreamCompleted),
            currentState: currentStateObservationForProductTasks(tasks, context.clock.now, this.lastStreamCompleted),
            acceptedDraftState: task ? draftObservationForProductTask(task, context.clock.now) : null,
        };
    }
}

export function createDeterministicProductRuntimeDriver(): DeterministicProductRuntimeHost {
    return new DeterministicProductRuntimeHost();
}
