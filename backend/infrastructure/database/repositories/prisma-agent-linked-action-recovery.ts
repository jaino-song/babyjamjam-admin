import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AgentTaskEntity } from "domain/entities/agent-task.entity";
import type {
    AgentLinkedActionRecoveryContext, AgentLinkedActionRecoveryOutcome, AgentLinkedActionRecoveryResult,
    AgentLinkedActionRecoveryScope, AgentLinkedActionRecoveryTransaction, AgentLinkedActionOutcomeResult,
} from "domain/repositories/agent-linked-action.types";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { toAgentActionEntity } from "./prisma-agent-action.repository";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "rejected", "expired"]);
class RecoveryAbort extends Error {
    constructor(readonly value: unknown) { super("Linked action recovery aborted"); }
}
function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return value == null ? Prisma.JsonNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

class RecoveryTransaction implements AgentLinkedActionRecoveryTransaction {
    constructor(private readonly tx: Prisma.TransactionClient, private readonly context: AgentLinkedActionRecoveryContext) {}
    abort<T>(value: T): never { throw new RecoveryAbort(value); }

    async applyOutcome(input: AgentLinkedActionRecoveryOutcome): Promise<AgentLinkedActionOutcomeResult> {
        const { action, task, linkage } = this.context;
        const status = input.kind === "execution-uncertain" || input.kind === "stale-execution" ? "uncertain"
            : input.kind === "review-rejected" ? "rejected" : input.kind === "review-expired" ? "expired" : input.status;
        if (action.status === status) return { status: "already_applied", action };
        const expected = input.kind === "reconciliation-terminal" ? ["uncertain"]
            : input.kind === "review-expired" ? ["proposed", "approved"]
                : input.kind === "review-rejected" ? ["proposed"] : ["executing"];
        if (!expected.includes(action.status)) return { status: "state_conflict" };
        if (input.kind === "review-rejected" && input.actorId !== action.userId) return { status: "state_conflict" };
        if (input.kind === "review-expired" && (action.expiresAt > input.deadline || input.deadline > input.transitionAt)) {
            return { status: "state_conflict" };
        }
        if (input.kind === "stale-execution" && (action.updatedAt.getTime() !== input.observedUpdatedAt.getTime()
            || action.updatedAt > input.cutoff || input.cutoff > input.transitionAt)) return { status: "state_conflict" };
        const review = input.kind === "review-rejected" || input.kind === "review-expired";
        if (linkage === "current" && (task.purgedAt || !action.taskRevision || action.taskRevision > task.revision
            || (review ? task.status !== "awaiting_approval"
                : input.kind === "reconciliation-terminal" ? task.status !== "reconciling" : task.status !== "executing"))) {
            return { status: "invariant_conflict" };
        }
        const data: Prisma.agent_actionUpdateManyMutationInput = {
            status, resultPartPersistedAt: null,
            ...(review ? {} : { executedAt: input.transitionAt }),
            ...("result" in input && input.result !== undefined ? { result: json(input.result) } : {}),
            ...("error" in input && input.error !== undefined ? { error: json(input.error) } : {}),
            ...(input.kind === "stale-execution" ? { error: { code: "execution_interrupted", message: "Execution was interrupted; reconcile before retrying" } } : {}),
            ...(input.kind === "review-rejected" ? { rejectedBy: input.actorId, rejectedAt: input.transitionAt,
                ...(input.reason ? { error: { code: "rejected", message: input.reason } } : {}) } : {}),
        };
        const changed = await this.tx.agent_action.updateMany({
            where: { id: action.id, taskId: task.taskId, sessionId: action.sessionId, userId: action.userId, branchId: action.branchId,
                status: action.status, ...(input.kind === "stale-execution" ? { updatedAt: input.observedUpdatedAt } : {}) }, data,
        });
        if (changed.count !== 1) return this.abort({ status: "state_conflict" });
        if (linkage === "current") {
            const draft = structuredClone(task.draft);
            draft.currentSnapshotRef = randomUUID();
            const live = this.context.sessionState === "live" && this.context.taskState === "live";
            let taskData: Prisma.agent_taskUpdateManyMutationInput;
            if (review) {
                delete draft.server.actionExpectedRevision;
                delete draft.server.actionProposalRevision;
                taskData = { activeActionId: null, activeSlot: live ? 1 : null, ...(live ? { status: "review_ready" } : {}) };
            } else if (status === "uncertain") {
                taskData = { status: "reconciling" };
            } else {
                if (task.terminalAt) return this.abort({ status: "invariant_conflict" });
                const expiry = new Date(input.transitionAt.getTime() + 7 * 86400000);
                taskData = { status: status === "succeeded" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
                    activeSlot: null, terminalAt: input.transitionAt, expiresAt: expiry };
                if (this.context.sessionState === "live") {
                    const retained = await this.tx.$executeRaw(Prisma.sql`
                        UPDATE "agent_session" SET "expires_at" = GREATEST("expires_at", ${expiry})
                        WHERE "id" = ${action.sessionId} AND "user_id" = CAST(${action.userId} AS uuid)
                          AND "branch_id" = CAST(${action.branchId} AS uuid)
                    `);
                    if (retained !== 1) return this.abort({ status: "invariant_conflict" });
                }
            }
            const updated = await this.tx.agent_task.updateMany({
                where: { id: task.taskId, sessionId: action.sessionId, userId: action.userId, branchId: action.branchId,
                    revision: task.revision, activeActionId: action.id },
                data: { ...taskData, draft: json(draft), revision: task.revision + 1 },
            });
            if (updated.count !== 1) return this.abort({ status: "invariant_conflict" });
        }
        const record = await this.tx.agent_action.findUnique({ where: { id: action.id } });
        if (!record) return this.abort({ status: "invariant_conflict" });
        const updatedAction = toAgentActionEntity(record);
        this.context.action = updatedAction;
        return { status: "applied", action: updatedAction };
    }

    async markResultPartPersisted(input: { expectedStatus: AgentLinkedActionRecoveryContext["action"]["status"]; persistedAt: Date }): Promise<boolean> {
        const { action } = this.context;
        if (!TERMINAL.has(input.expectedStatus) && input.expectedStatus !== "uncertain") return false;
        if (action.status !== input.expectedStatus) {
            // A stale result upsert may have raced with the authoritative terminal
            // message. Re-open repair for that newer outcome without changing TTL.
            if (TERMINAL.has(action.status) || action.status === "uncertain") {
                await this.tx.agent_action.updateMany({ where: { id: action.id, status: action.status, taskId: action.taskId },
                    data: { resultPartPersistedAt: null } });
            }
            return false;
        }
        if (action.resultPartPersistedAt) return true;
        const updated = await this.tx.agent_action.updateMany({
            where: { id: action.id, status: input.expectedStatus, taskId: action.taskId, resultPartPersistedAt: null },
            data: { resultPartPersistedAt: input.persistedAt },
        });
        return updated.count === 1;
    }
}

/** Inactive recovery is intentionally separate from ordinary live task writes. */
export async function withLinkedActionRecovery<T>(
    prisma: PrismaService,
    scope: AgentLinkedActionRecoveryScope,
    decodeTask: (record: Prisma.agent_taskGetPayload<Prisma.agent_taskDefaultArgs>) => AgentTaskEntity,
    operation: (transaction: AgentLinkedActionRecoveryTransaction, context: AgentLinkedActionRecoveryContext) => Promise<T>,
): Promise<AgentLinkedActionRecoveryResult<T>> {
    try {
        return await prisma.$transaction(async (tx): Promise<AgentLinkedActionRecoveryResult<T>> => {
            const sessions = await tx.$queryRaw<Array<{ expiresAt: Date; archivedAt: Date | null }>>(Prisma.sql`
                SELECT "expires_at" AS "expiresAt", "archived_at" AS "archivedAt" FROM "agent_session"
                WHERE "id" = ${scope.sessionId} AND "user_id" = CAST(${scope.userId} AS uuid)
                  AND "branch_id" = CAST(${scope.branchId} AS uuid) FOR UPDATE
            `);
            const session = sessions[0];
            if (!session) return { status: "not_found" };
            const tasks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id" FROM "agent_task" WHERE "id" = ${scope.taskId} AND "session_id" = ${scope.sessionId}
                  AND "user_id" = CAST(${scope.userId} AS uuid) AND "branch_id" = CAST(${scope.branchId} AS uuid) FOR UPDATE
            `);
            if (!tasks.length) return { status: "not_found" };
            const actions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id" FROM "agent_action" WHERE "id" = ${scope.actionId} AND "session_id" = ${scope.sessionId}
                  AND "user_id" = CAST(${scope.userId} AS uuid) AND "branch_id" = CAST(${scope.branchId} AS uuid) FOR UPDATE
            `);
            if (!actions.length) return { status: "not_found" };
            const taskRecord = await tx.agent_task.findUnique({ where: { id: scope.taskId } });
            const actionRecord = await tx.agent_action.findUnique({ where: { id: scope.actionId } });
            if (!taskRecord || !actionRecord) return { status: "not_found" };
            if (actionRecord.taskId !== scope.taskId) return { status: "binding_mismatch" };
            const task = decodeTask(taskRecord);
            const action = toAgentActionEntity(actionRecord);
            const current = task.activeActionId === action.id;
            if (current && task.purgedAt && (!TERMINAL.has(action.status) || !action.resultPartPersistedAt)) {
                return { status: "invariant_conflict" };
            }
            const now = new Date();
            const context: AgentLinkedActionRecoveryContext = {
                session: { ...scope, expiresAt: session.expiresAt, archivedAt: session.archivedAt }, task, action,
                linkage: current ? "current" : "historical",
                sessionState: session.archivedAt ? "archived" : session.expiresAt <= now ? "expired" : "live",
                taskState: task.purgedAt ? "purged" : task.expiresAt <= now ? "expired" : "live",
            };
            const value = await operation(new RecoveryTransaction(tx, context), context);
            return { status: "ok", value };
        });
    } catch (error) {
        if (error instanceof RecoveryAbort) return { status: "aborted", value: error.value as T };
        return { status: "storage_failure" };
    }
}
