import type { AgentActionEntity } from "domain/entities/agent-action.entity";
import type { AgentTask, AgentTaskCapabilityId, AgentTaskState } from "@babyjamjam/shared";
import type {
    AgentLinkedActionLiveOperation, AgentLinkedActionLiveResult,
    AgentLinkedActionRecoveryScope, AgentLinkedActionRecoveryTransaction,
    AgentLinkedActionRecoveryContext, AgentLinkedActionRecoveryResult,
} from "./agent-linked-action.types";

import type {
    AgentTaskDraft,
    AgentTaskEntity,
    AgentTaskEventEntity,
    AgentTaskOwner,
    AgentTaskTombstone,
} from "domain/entities/agent-task.entity";

export interface AgentTaskSessionScope extends AgentTaskOwner {
    sessionId: string;
}

export interface AgentTaskSessionMetadata extends AgentTaskSessionScope {
    expiresAt: Date;
    archivedAt: Date | null;
}

export type AgentTaskSessionLockResult =
    | { status: "locked"; session: AgentTaskSessionMetadata }
    | { status: "not_found" }
    | { status: "session_archived"; session: AgentTaskSessionMetadata }
    | { status: "session_expired"; session: AgentTaskSessionMetadata }
    | { status: "storage_failure" };

export type AgentTaskTaskLockResult =
    | { status: "locked"; task: AgentTaskEntity }
    | { status: "not_found" }
    | { status: "task_expired"; tombstone: AgentTaskTombstone; task: AgentTaskEntity }
    | { status: "task_purged"; tombstone: AgentTaskTombstone }
    | { status: "storage_failure" };

export type AgentTaskReadResult =
    | { status: "found"; task: AgentTaskEntity }
    | { status: "not_found" }
    | { status: "session_archived"; session: AgentTaskSessionMetadata }
    | { status: "session_expired"; session: AgentTaskSessionMetadata }
    | { status: "task_expired"; tombstone: AgentTaskTombstone; task: AgentTaskEntity }
    | { status: "task_purged"; tombstone: AgentTaskTombstone }
    | { status: "storage_failure" };

export type AgentTaskListResult =
    | { status: "found"; tasks: AgentTaskEntity[] }
    | { status: "not_found" }
    | { status: "session_archived"; session: AgentTaskSessionMetadata }
    | { status: "session_expired"; session: AgentTaskSessionMetadata }
    | { status: "storage_failure" };

/**
 * Recovery reads are deliberately narrower than ordinary task reads.  They
 * expose an owned task only when its opaque action link is backed by the same
 * owner/session/task action row and that action still needs recovery.
 */
export type AgentTaskRecoveryReadResult =
    | { status: "found"; task: AgentTaskEntity }
    | { status: "not_found" }
    | { status: "storage_failure" };

export type AgentTaskRecoveryListResult =
    | { status: "found"; taskIds: string[] }
    | { status: "not_found" }
    | { status: "storage_failure" };

export type AgentTaskSessionRetentionResult =
    | { status: "extended"; expiresAt: Date }
    | { status: "unchanged"; expiresAt: Date }
    | { status: "storage_failure" };

export interface CreateAgentTaskInput {
    taskId: string;
    capabilityId: AgentTaskCapabilityId;
    draft: AgentTaskDraft;
    schemaVersion?: AgentTask["schemaVersion"];
    revision?: number;
    status?: AgentTaskState;
    targetRef?: string | null;
    targetVersion?: string | null;
    activeActionId?: string | null;
    lastAcceptedAt?: Date;
    expiresAt: Date;
    terminalAt?: Date | null;
    purgedAt?: Date | null;
}

export interface UpdateAgentTaskInput {
    expectedRevision: number;
    draft?: AgentTaskDraft;
    status?: AgentTaskState;
    targetRef?: string | null;
    targetVersion?: string | null;
    activeActionId?: string | null;
    acceptedAt?: Date;
    /** Derived choices advance task revision without extending acceptance TTL. */
    preserveLastAcceptedAt?: boolean;
    expiresAt?: Date;
    terminalAt?: Date | null;
    purgedAt?: Date | null;
}

export interface AgentTaskEventInput {
    clientEventId: string;
    operation: string;
    requestHash: string;
    acceptedRevision: number;
    resultActionId?: string | null;
    acceptedAt?: Date;
}

export interface AgentTaskEventReceipt {
    serverEventId: string;
    eventId: string;
    taskId: string;
    requestHash: string;
    operation: string;
    acceptedRevision: number;
    resultActionId: string | null;
    acceptedAt: Date;
    currentSnapshotRef: string;
}

export type AgentTaskCreateResult =
    | { status: "created"; task: AgentTaskEntity }
    | { status: "not_found" | "session_archived" | "session_expired" }
    | { status: "active_task_conflict" }
    | { status: "storage_failure" };

export type AgentTaskUpdateResult =
    | { status: "updated"; task: AgentTaskEntity }
    | { status: "stale_revision"; currentTask: AgentTaskEntity }
    | { status: "not_found" | "session_archived" | "session_expired" }
    | { status: "task_expired"; task: AgentTaskEntity }
    | { status: "task_purged"; tombstone: AgentTaskTombstone }
    | { status: "active_task_conflict" }
    | { status: "storage_failure" };

export type AgentTaskEventLookupResult =
    | { status: "not_found" }
    | { status: "found"; event: AgentTaskEventEntity }
    | { status: "storage_failure" };

export type AgentTaskEventInsertResult =
    | { status: "inserted"; event: AgentTaskEventEntity }
    | { status: "event_hash_conflict" }
    | { status: "storage_failure" };

export type AgentTaskMutationResult =
    | { status: "created" | "updated"; task: AgentTaskEntity; receipt: AgentTaskEventReceipt }
    | { status: "event_replay"; task: AgentTaskEntity; receipt: AgentTaskEventReceipt }
    | { status: "event_hash_conflict"; event?: AgentTaskEventEntity }
    | { status: "stale_revision"; currentTask: AgentTaskEntity }
    | { status: "not_found" | "session_archived" | "session_expired" }
    | { status: "task_expired"; task: AgentTaskEntity }
    | { status: "task_purged"; tombstone: AgentTaskTombstone }
    | { status: "active_task_conflict" }
    | { status: "storage_failure" };

export interface AgentTaskTransaction {
    /** Branch-scoped client lock held until the prepared task conversion commits. */
    lockClientTargetVersion(clientId: number): Promise<{ status: "found"; version: string } | { status: "not_found" | "storage_failure" }>;
    lockCurrentAction(): Promise<AgentActionEntity | null>;
    /** Closed operations only; owns correlated task, action and receipt writes. */
    applyLinkedAction(operation: AgentLinkedActionLiveOperation): Promise<AgentLinkedActionLiveResult>;
    /** Must be called before any task/event write in this transaction. */
    lockSession(): Promise<AgentTaskSessionLockResult>;
    /** Locks only a task owned by the already locked session. */
    lockTask(taskId: string): Promise<AgentTaskTaskLockResult>;
    findEvent(clientEventId: string): Promise<AgentTaskEventLookupResult>;
    createTask(input: CreateAgentTaskInput): Promise<AgentTaskCreateResult>;
    updateTask(input: UpdateAgentTaskInput): Promise<AgentTaskUpdateResult>;
    insertEvent(input: AgentTaskEventInput): Promise<AgentTaskEventInsertResult>;
    readTask(taskId: string): Promise<AgentTaskReadResult>;
    /**
     * Monotonically extend the already-held owner-scoped session lock.  The
     * adapter must apply GREATEST(current, minExpiry) in this transaction.
     */
    ensureSessionRetention(minExpiry: Date): Promise<AgentTaskSessionRetentionResult>;
    /**
     * Abort the enclosing transaction after a write and return the supplied
     * domain value to the caller. Implementations must roll back before
     * exposing that value; no Prisma error or client leaks through this port.
     */
    abort<T>(result: T): never;
}

export type AgentTaskTransactionResult<T> =
    | { status: "ok"; value: T }
    | { status: "aborted"; value: T }
    | { status: "active_task_conflict" }
    | { status: "event_hash_conflict"; event?: AgentTaskEventEntity }
    | { status: "storage_failure" };

export interface IAgentTaskRepository {
    withLinkedActionRecoveryTransaction<T>(
        scope: AgentLinkedActionRecoveryScope,
        operation: (transaction: AgentLinkedActionRecoveryTransaction, context: AgentLinkedActionRecoveryContext) => Promise<T>,
    ): Promise<AgentLinkedActionRecoveryResult<T>>;
    findOwned(taskId: string, owner: AgentTaskOwner): Promise<AgentTaskReadResult>;
    findOwnedRecovery(taskId: string, owner: AgentTaskOwner): Promise<AgentTaskRecoveryReadResult>;
    listOwned(session: AgentTaskSessionScope): Promise<AgentTaskListResult>;
    listOwnedRecovery(scope: AgentTaskSessionScope): Promise<AgentTaskRecoveryListResult>;
    withTransaction<T>(
        scope: AgentTaskSessionScope,
        operation: (transaction: AgentTaskTransaction) => Promise<T>,
    ): Promise<AgentTaskTransactionResult<T>>;
    createWithEvent(
        scope: AgentTaskSessionScope,
        input: CreateAgentTaskInput,
        event: AgentTaskEventInput,
    ): Promise<AgentTaskMutationResult>;
    updateWithEvent(
        scope: AgentTaskSessionScope,
        taskId: string,
        input: UpdateAgentTaskInput,
        event: AgentTaskEventInput,
    ): Promise<AgentTaskMutationResult>;
    /** Run the guarded hourly payload purge for expired tasks. */
    purgeExpired(now: Date): Promise<number>;
}

export const AGENT_TASK_REPOSITORY = Symbol("AGENT_TASK_REPOSITORY");
