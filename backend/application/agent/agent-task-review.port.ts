import type { AgentTaskEntity } from "domain/entities/agent-task.entity";
import type { PreparedAgentTaskReview } from "domain/repositories/agent-linked-action.types";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

/** Preparation performs reads only. The caller owns atomic attachment. */
export interface AgentTaskReviewPort {
    prepareTaskReview(task: AgentTaskEntity, principal: VerifiedTenantPrincipal): Promise<PreparedAgentTaskReview>;
}
export const AGENT_TASK_REVIEW = Symbol("AGENT_TASK_REVIEW");
