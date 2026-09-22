import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AgentTaskEntity } from "domain/entities/agent-task.entity";
import type { AgentTaskAutomationState } from "domain/entities/agent-automation-consent";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { CapabilityRegistryService } from "./capability-registry.service";
import { createAgentAutomationQuestion, parseAgentTaskAutomationState } from "./agent-automation-question";

export type AgentTaskAutomationSource = Pick<AgentTaskEntity,
    "taskId" | "sessionId" | "userId" | "branchId" | "capabilityId" | "targetRef" | "targetVersion" | "draft">;
export interface AgentTaskAutomationPort {
    evaluate(task: AgentTaskAutomationSource, principal: VerifiedTenantPrincipal): Promise<AgentTaskAutomationState>;
}
export const AGENT_TASK_AUTOMATION = Symbol("AGENT_TASK_AUTOMATION");

/** Evaluates protected server input only. All provider reads run outside task locks. */
@Injectable()
export class AgentTaskAutomationService implements AgentTaskAutomationPort {
    constructor(private readonly registry: CapabilityRegistryService) {}

    async evaluate(task: AgentTaskAutomationSource, principal: VerifiedTenantPrincipal): Promise<AgentTaskAutomationState> {
        const unavailable = (reason: "source-unavailable" | "missing-input" = "source-unavailable"): AgentTaskAutomationState => ({ version: 1, effects: [],
            noSendAtPresentation: task.draft.constraints.noSend,
            question: createAgentAutomationQuestion({ availability: "unavailable", reason, effects: [],
                previous: task.draft.server.automation?.question }),
        });
        if (task.userId !== principal.userId || task.branchId !== principal.branchId) return unavailable();
        const target = task.draft.server.references.target;
        if (task.capabilityId === "clients.update" && (!target || !task.targetVersion || target.targetRef !== task.targetRef)) {
            return unavailable("missing-input");
        }
        try {
            const capability = this.registry.get(task.capabilityId);
            if (!capability.planAutomationImpact) return unavailable();
            const input = capability.inputSchema.safeParse({ ...task.draft.confirmed,
                ...Object.fromEntries(task.draft.clearedFields.map((field) => [field, null])),
                ...(task.capabilityId === "clients.update" ? { id: target!.clientId, targetVersion: task.targetVersion } : {}),
            });
            if (!input.success) return unavailable("missing-input");
            const context = { principal, sessionId: task.sessionId, traceId: randomUUID(), locale: "ko" };
            const normalized = capability.canonicalizeInput
                ? capability.inputSchema.parse(await capability.canonicalizeInput(context, input.data)) : input.data;
            const impact = await capability.planAutomationImpact(context, normalized, task.taskId);
            // An incomplete discovery cannot become an available or empty answer.
            if (!impact.complete && impact.availability !== "unavailable") return unavailable();
            const state = { version: 1, effects: impact.effects, noSendAtPresentation: task.draft.constraints.noSend,
                question: createAgentAutomationQuestion({ effects: impact.effects, availability: impact.availability,
                    reason: impact.reason, previous: task.draft.server.automation?.question }),
            };
            return parseAgentTaskAutomationState(state) ?? unavailable();
        } catch {
            // Provider validation/storage failures contain customer inputs in some
            // paths. Only the finite availability reason crosses this boundary.
            return unavailable();
        }
    }
}
