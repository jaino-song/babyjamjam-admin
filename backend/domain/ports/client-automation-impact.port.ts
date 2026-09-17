import type { AgentAutomationQuestion } from "@babyjamjam/shared";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";

/** Internal normalized customer write; never accepted as a controller/model payload. */
export interface ClientAutomationWriteValues {
    name?: string;
    phone?: string | null;
    type?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    areaId?: string | null;
}

export type ClientAutomationWrite =
    | { kind: "create"; taskId: string; values: ClientAutomationWriteValues }
    | { kind: "update"; clientId: number; values: ClientAutomationWriteValues };

/** Private read result. No recipient, source field, rendered content or provider configuration preimage. */
export interface ClientAutomationImpact {
    availability: AgentAutomationQuestion["availability"];
    reason?: AgentAutomationQuestion["reason"];
    effects: AgentAutomationEffect[];
    /** False means source discovery was incomplete; even negative materialization requires a fresh complete read. */
    complete: boolean;
    clientIdentity: string | null;
    sourceGuard: string;
    affectedJobs: { id: string; version: string }[];
}

export interface ClientAutomationImpactPort {
    planClientWrite(branchId: string, write: ClientAutomationWrite): Promise<ClientAutomationImpact>;
}
export const CLIENT_AUTOMATION_IMPACT = Symbol("CLIENT_AUTOMATION_IMPACT");
