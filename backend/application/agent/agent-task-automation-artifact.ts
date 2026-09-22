import { z } from "zod";
import { AgentAutomationConsentSchema, AgentAutomationQuestionSchema, type AgentCapabilityMeta } from "@babyjamjam/shared";
import type { AgentTaskEntity } from "domain/entities/agent-task.entity";
import type { AgentActionEntity } from "domain/entities/agent-action.entity";
import type { ClientAutomationImpact } from "domain/ports/client-automation-impact.port";
import { agentBindingHash, agentLinkedProposalRevision } from "domain/repositories/agent-linked-action.types";
import { AgentAutomationEffectStorageSchema } from "./agent-automation-storage.schema";
import { canonicalAgentAutomationEffects } from "./agent-automation-consent";
import { createAgentAutomationQuestion, parseAgentTaskAutomationState, reconcileAgentAutomationConsent } from "./agent-automation-question";

/** Server-owned proposal member. Public projections must explicitly omit it. */
export const TASK_AUTOMATION_ARTIFACT_KEY = "_taskAutomation";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const impactSchema = z.object({
    availability: AgentAutomationQuestionSchema.shape.availability,
    reason: AgentAutomationQuestionSchema.shape.reason,
    effects: z.array(AgentAutomationEffectStorageSchema).max(500),
    grandfatheredEffects: z.array(AgentAutomationEffectStorageSchema).max(500).default([]),
    complete: z.boolean(), clientIdentity: digest.nullable(), sourceGuard: digest,
    affectedJobs: z.array(z.object({ id: z.string().uuid(), version: digest }).strict()).max(500),
}).strict();

const artifactSchema = z.object({
    version: z.literal(1), actionId: z.string().uuid(), taskId: z.string().uuid(), taskRevision: z.number().int().positive(),
    sessionId: z.string().min(1), userId: z.string().uuid(), branchId: z.string().uuid(),
    capability: z.enum(["clients.create", "clients.update"]), inputHash: digest,
    targetClientId: z.number().int().positive().nullable(), targetVersion: digest.nullable(),
    question: AgentAutomationQuestionSchema, consent: AgentAutomationConsentSchema, noSend: z.boolean(),
    impact: impactSchema,
}).strict();

export type AgentTaskAutomationArtifact = z.infer<typeof artifactSchema>;

export function canonicalTaskAutomationImpact(value: unknown): ClientAutomationImpact {
    const parsed = impactSchema.parse(value);
    if (new Set(parsed.affectedJobs.map((job) => job.id)).size !== parsed.affectedJobs.length) throw new Error("Invalid automation impact");
    return { ...parsed, effects: canonicalAgentAutomationEffects(parsed.effects),
        grandfatheredEffects: canonicalAgentAutomationEffects(parsed.grandfatheredEffects),
        affectedJobs: [...parsed.affectedJobs].sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Strict parsing checks semantic bindings as well as JSON shape; it grants no execution authority. */
export function parseTaskAutomationArtifact(value: unknown): AgentTaskAutomationArtifact | null {
    try {
        const artifact = artifactSchema.parse(value);
        const impact = canonicalTaskAutomationImpact(artifact.impact);
        if (!impact.complete || (artifact.capability === "clients.create"
            ? artifact.targetClientId !== null || artifact.targetVersion !== null || impact.clientIdentity !== null
            : artifact.targetClientId === null || artifact.targetVersion === null || impact.clientIdentity === null)) return null;
        const current = createAgentAutomationQuestion({ ...impact, previous: artifact.question });
        if (agentBindingHash(current) !== agentBindingHash(artifact.question)) return null;
        const consent = reconcileAgentAutomationConsent({ previous: artifact.question, current,
            consent: artifact.consent, previousNoSend: artifact.noSend, noSend: artifact.noSend });
        if (agentBindingHash(consent) !== agentBindingHash(artifact.consent)
            || (current.availability !== "none" && consent.choice === "unanswered")) return null;
        return { ...artifact, impact: { ...impact, grandfatheredEffects: impact.grandfatheredEffects ?? [] } };
    } catch {
        return null;
    }
}

export function prepareTaskAutomationArtifact(task: AgentTaskEntity, actionId: string,
    normalizedInput: unknown, impact: ClientAutomationImpact): AgentTaskAutomationArtifact {
    const state = parseAgentTaskAutomationState(task.draft.server.automation);
    if (!state || state.noSendAtPresentation !== task.draft.constraints.noSend) throw new Error("Automation question required");
    const artifact = parseTaskAutomationArtifact({ version: 1, actionId, taskId: task.taskId, taskRevision: task.revision + 1,
        sessionId: task.sessionId, userId: task.userId, branchId: task.branchId, capability: task.capabilityId,
        inputHash: agentBindingHash(normalizedInput), targetClientId: task.draft.server.references.target?.clientId ?? null,
        targetVersion: task.targetVersion, question: state.question,
        consent: task.draft.constraints.noSend ? { choice: "no", binding: null } : task.draft.consent,
        noSend: task.draft.constraints.noSend,
        impact: { ...impact, grandfatheredEffects: impact.grandfatheredEffects ?? [] } });
    if (!artifact) throw new Error("Automation question changed or incomplete");
    return artifact;
}

/** Preserve the catalog's stronger policy; only a customer task may strengthen a reversible write. */
export function taskAutomationEffectiveMeta(meta: AgentCapabilityMeta, artifact: AgentTaskAutomationArtifact): AgentCapabilityMeta {
    if (meta.name !== artifact.capability || !meta.sideEffect || meta.risk === "read") throw new Error("Invalid automation capability");
    if (artifact.consent.choice !== "yes") return meta;
    return { ...meta, risk: meta.risk === "reversible-write" || meta.risk === "irreversible-write" ? "external-side-effect" : meta.risk,
        approvalPolicy: "strong" };
}

/** Validate the persisted action before producing a private execution context. */
export function taskAutomationFromAction(action: AgentActionEntity, meta: AgentCapabilityMeta): AgentTaskAutomationArtifact | null {
    const artifact = parseTaskAutomationArtifact(action.proposal[TASK_AUTOMATION_ARTIFACT_KEY]);
    if (!artifact || artifact.actionId !== action.id || artifact.taskId !== action.taskId || artifact.taskRevision !== action.taskRevision
        || artifact.sessionId !== action.sessionId || artifact.userId !== action.userId || artifact.branchId !== action.branchId
        || artifact.capability !== action.capability || artifact.inputHash !== action.inputHash
        || artifact.inputHash !== agentBindingHash(action.proposal["input"]) || artifact.targetVersion !== action.targetVersion
        || agentBindingHash(action.proposal["automation"]) !== agentBindingHash(taskAutomationPublicSummary(artifact))
        || action.proposalRevision !== agentLinkedProposalRevision(artifact.taskId, artifact.taskRevision, action)) return null;
    const input = action.proposal["input"] as Record<string, unknown> | null;
    if (artifact.capability === "clients.update" && (input?.["id"] !== artifact.targetClientId || input?.["targetVersion"] !== artifact.targetVersion)) return null;
    try {
        const effective = taskAutomationEffectiveMeta(meta, artifact);
        return action.risk === effective.risk && action.authorizationContext["approvalPolicy"] === effective.approvalPolicy ? artifact : null;
    } catch {
        return null;
    }
}

export function taskAutomationPublicSummary(artifact: AgentTaskAutomationArtifact) {
    return { choice: artifact.consent.choice, noSend: artifact.noSend, question: artifact.question };
}
