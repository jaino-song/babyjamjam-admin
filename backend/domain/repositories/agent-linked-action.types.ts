import { createHash } from "node:crypto";
import type { AgentActionEntity } from "domain/entities/agent-action.entity";
import type { AgentTaskEntity, AgentTaskEventEntity } from "domain/entities/agent-task.entity";
import type { CreateAgentActionInput } from "./agent-action.repository.interface";
import type {
    AgentTaskEventInput, AgentTaskSessionMetadata, AgentTaskSessionScope, UpdateAgentTaskInput,
} from "./agent-task.repository.interface";

export function agentBindingHash(value: unknown): string {
    const canonical = (item: unknown): string => {
        if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
        if (item && typeof item === "object") {
            return `{${Object.entries(item).filter(([, v]) => v !== undefined)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
        }
        return JSON.stringify(item) ?? "null";
    };
    return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Covers the authoritative preparation source, including protected references. */
export function agentTaskSourceHash(task: AgentTaskEntity): string {
    return agentBindingHash({
        taskId: task.taskId, revision: task.revision, capabilityId: task.capabilityId,
        draft: task.draft, targetRef: task.targetRef, targetVersion: task.targetVersion,
    });
}

export function agentLinkedProposalRevision(taskId: string, taskRevision: number, action: Pick<AgentActionEntity,
    "capability" | "capabilityVersion" | "risk" | "proposal">): string {
    return agentBindingHash({ taskId, taskRevision, capability: action.capability,
        capabilityVersion: action.capabilityVersion, risk: action.risk, proposal: action.proposal });
}

export interface PreparedAgentTaskReview {
    taskId: string;
    sourceRevision: number;
    sourceHash: string;
    action: Omit<CreateAgentActionInput, "status">;
}

export interface AgentActionClaimEvidence {
    actionId: string;
    taskId: string;
    taskRevision: number;
    proposalRevision: string;
    inputHash: string;
    targetHash: string;
    capability: string;
    capabilityVersion: string;
    risk: AgentActionEntity["risk"];
    /** Server policy result bound to the same immutable proposal. */
    acknowledgement: "standard" | { token: string };
    actorId: string;
}

export type AgentLinkedActionLiveOperation =
    | { kind: "attach-review"; prepared: PreparedAgentTaskReview; event: AgentTaskEventInput }
    | { kind: "invalidate-review"; sourceHash: string; next: Pick<UpdateAgentTaskInput, "expectedRevision" | "draft" | "status" | "acceptedAt" | "expiresAt">; event: AgentTaskEventInput }
    | { kind: "cancel-task"; sourceHash: string; event: AgentTaskEventInput }
    | { kind: "claim-execution"; evidence: AgentActionClaimEvidence; transitionAt: Date };

export type AgentLinkedActionLiveResult =
    | { status: "applied"; action: AgentActionEntity; task: AgentTaskEntity; event: AgentTaskEventEntity }
    | { status: "already_applied"; action: AgentActionEntity; task: AgentTaskEntity }
    | { status: "binding_mismatch" | "state_conflict" | "storage_failure" };

type ExecutionFields = { transitionAt: Date; result?: unknown; error?: Record<string, unknown> | null };
export type AgentLinkedActionRecoveryOutcome =
    | (ExecutionFields & { kind: "execution-uncertain" })
    | (ExecutionFields & { kind: "execution-terminal"; status: "succeeded" | "failed" | "cancelled" })
    | (ExecutionFields & { kind: "reconciliation-terminal"; status: "succeeded" | "failed" })
    | { kind: "stale-execution"; transitionAt: Date; observedUpdatedAt: Date; cutoff: Date }
    | { kind: "review-rejected"; transitionAt: Date; actorId: string; reason?: string }
    | { kind: "review-expired"; transitionAt: Date; deadline: Date };

export interface AgentLinkedActionRecoveryScope extends AgentTaskSessionScope {
    taskId: string;
    actionId: string;
}
export interface AgentLinkedActionRecoveryContext {
    session: AgentTaskSessionMetadata;
    task: AgentTaskEntity;
    action: AgentActionEntity;
    linkage: "current" | "historical";
    sessionState: "live" | "archived" | "expired";
    taskState: "live" | "expired" | "purged";
}
export type AgentLinkedActionOutcomeResult =
    | { status: "applied" | "already_applied"; action: AgentActionEntity }
    | { status: "state_conflict" | "invariant_conflict" };
export interface AgentLinkedActionRecoveryTransaction {
    applyOutcome(input: AgentLinkedActionRecoveryOutcome): Promise<AgentLinkedActionOutcomeResult>;
    markResultPartPersisted(input: { expectedStatus: AgentActionEntity["status"]; persistedAt: Date }): Promise<boolean>;
    abort<T>(value: T): never;
}
export type AgentLinkedActionRecoveryResult<T> =
    | { status: "ok" | "aborted"; value: T }
    | { status: "not_found" | "binding_mismatch" | "invariant_conflict" | "storage_failure" };
