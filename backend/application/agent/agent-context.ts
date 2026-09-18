import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import type { AgentTaskAutomationArtifact } from "./agent-task-automation-artifact";

export interface AgentContext {
    principal: VerifiedTenantPrincipal;
    sessionId: string;
    traceId: string;
    locale: string;
    /** Present only while executing an approved durable action. */
    actionId?: string;
    /** Immutable target identity captured in the durable action proposal. */
    approvedTargetVersion?: string;
    /** Immutable provider-bound target snapshot captured at proposal time. */
    approvedTargetSnapshot?: Record<string, unknown>;
    /** Parsed from the owned immutable action by the coordinator, never model input. */
    taskAutomation?: AgentTaskAutomationArtifact;
}
