import { z } from "zod";
import { AgentAutomationEffectSummarySchema } from "@babyjamjam/shared";
import type { AgentAutomationAuthority, AgentAutomationCoverage, AgentAutomationJobSeal } from "domain/entities/agent-automation-consent";
import { isAgentAutomationCoverageScopeValid, isAgentAutomationEffectVariantValid, isAgentAutomationOperationValid } from "domain/entities/agent-automation-consent";
import { agentAutomationEffectDigest, agentAutomationRecordDigest } from "./agent-automation-consent";
import { agentAutomationCoverageRecordDigest } from "./agent-automation-coverage";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ruleId = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/);

export const AgentAutomationEffectStorageSchema = AgentAutomationEffectSummarySchema
    .omit({ effectRef: true, recipientRef: true })
    .extend({
        ruleId,
        scheduleId: positiveId.nullable(),
        recipientDigest: digest, sourceDigest: digest, templateDigest: digest, policyDigest: digest, recipeDigest: digest,
    }).strict().superRefine((effect, context) => {
        if (!isAgentAutomationEffectVariantValid(effect)) {
            context.addIssue({ code: "custom", message: "Inconsistent automation effect target" });
        }
    });

export const AgentAutomationScopeStorageSchema = z.object({
    branchId: z.uuid(), clientId: positiveId, clientIdentity: digest,
    kind: AgentAutomationEffectSummarySchema.shape.kind, scheduleId: positiveId.nullable(),
    ruleId, recipientType: AgentAutomationEffectSummarySchema.shape.recipientType, scheduleIdentity: digest.nullable(),
}).strict().superRefine((scope, context) => {
    if (!isAgentAutomationOperationValid(scope)
        || (scope.scheduleId === null) !== (scope.scheduleIdentity === null)) {
        context.addIssue({ code: "custom", message: "Inconsistent automation scope" });
    }
});

const origin = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("task"), userId: z.uuid(), actionId: z.uuid(), taskId: z.uuid(),
        taskRevision: positiveId, consentEventId: z.uuid().nullable() }).strict(),
    z.object({ kind: z.literal("ordinary"), mutationId: z.uuid(),
        operation: z.enum(["client-write", "schedule-write", "manual-message", "agent-message-retry"]) }).strict(),
]);

export const AgentAutomationAuthorityStorageSchema = z.object({
    version: z.literal(1), id: z.uuid(), scope: AgentAutomationScopeStorageSchema,
    sequence: positiveId, previousId: z.uuid().nullable(), origin,
    decision: z.enum(["allow", "deny", "none"]), noSend: z.boolean(),
    effects: z.array(AgentAutomationEffectStorageSchema).max(500), scopeEffectDigest: digest,
    reviewedEffectDigest: digest, reviewedPolicyDigest: digest, recordedAt: z.iso.datetime(), recordDigest: digest,
}).strict().superRefine((record, context) => {
    try {
        if (record.recordDigest !== agentAutomationRecordDigest(record)
            || record.scopeEffectDigest !== agentAutomationEffectDigest(record.effects)
            || record.effects.some((effect) => effect.kind !== record.scope.kind || effect.scheduleId !== record.scope.scheduleId
                || effect.ruleId !== record.scope.ruleId || effect.recipientType !== record.scope.recipientType)
            || (record.decision === "allow" && (record.noSend || !record.effects.length
                || (record.origin.kind === "task" && !record.origin.consentEventId)))
            || (record.decision === "deny" && !record.effects.length)
            || (record.decision === "none" && record.effects.length !== 0)) {
            context.addIssue({ code: "custom", message: "Invalid automation authority binding" });
        }
    } catch {
        context.addIssue({ code: "custom", message: "Ambiguous automation authority effects" });
    }
});

export const AgentAutomationJobSealStorageSchema = z.object({
    version: z.literal(1), authorityId: z.uuid(), authorityDigest: digest,
    scope: AgentAutomationScopeStorageSchema, memberDigest: digest, reviewedEffectDigest: digest, concreteJobDigest: digest,
}).strict();

export const AgentAutomationCoverageScopeStorageSchema = z.object({
    branchId: z.uuid(), clientId: positiveId, clientIdentity: digest,
    kind: AgentAutomationEffectSummarySchema.shape.kind, scheduleId: positiveId.nullable(),
    recipientType: AgentAutomationEffectSummarySchema.shape.recipientType, scheduleIdentity: digest.nullable(),
}).strict().refine(isAgentAutomationCoverageScopeValid, "Inconsistent automation coverage scope");

export const AgentAutomationCoverageStorageSchema = z.object({
    kind: z.literal("coverage"), version: z.literal(1), id: z.uuid(), scope: AgentAutomationCoverageScopeStorageSchema,
    sequence: positiveId, previousId: z.uuid().nullable(), origin, mutationDigest: digest,
    grandfatheredScopes: z.array(z.object({ scope: AgentAutomationScopeStorageSchema, fingerprint: digest }).strict()).max(500),
    recordedAt: z.iso.datetime(), recordDigest: digest,
}).strict().superRefine((record, context) => {
    try {
        if (record.recordDigest !== agentAutomationCoverageRecordDigest(record)
            || (record.origin.kind === "ordinary" && !["client-write", "schedule-write"].includes(record.origin.operation))) {
            context.addIssue({ code: "custom", message: "Invalid automation coverage binding" });
        }
    } catch {
        context.addIssue({ code: "custom", message: "Ambiguous automation coverage scopes" });
    }
});

/** Private committed association; never included in a capability's public result. */
export const AgentAutomationReceiptMetadataSchema = z.object({
    version: z.literal(1), taskId: z.uuid(), taskRevision: positiveId, questionRef: z.uuid(),
    reviewedEffectDigest: digest, reviewedPolicyDigest: digest,
    authorities: z.array(z.object({ id: z.uuid(), recordDigest: digest, scopeDigest: digest }).strict()).max(500),
    coverages: z.array(z.object({ id: z.uuid(), recordDigest: digest, scopeDigest: digest }).strict()).max(500).optional(),
}).strict().superRefine((metadata, context) => {
    const coverages = metadata.coverages ?? [];
    const all = [...metadata.authorities, ...coverages];
    if (!all.length || new Set(all.map(({ id }) => id)).size !== all.length
        || new Set(metadata.authorities.map(({ scopeDigest }) => scopeDigest)).size !== metadata.authorities.length
        || new Set(coverages.map(({ scopeDigest }) => scopeDigest)).size !== coverages.length) {
        context.addIssue({ code: "custom", message: "Duplicate committed automation scope" });
    }
});

export function parseAgentAutomationAuthority(value: unknown): AgentAutomationAuthority | null {
    const result = AgentAutomationAuthorityStorageSchema.safeParse(value);
    return result.success ? result.data : null;
}

export function parseAgentAutomationJobSeal(value: unknown): AgentAutomationJobSeal | null {
    const result = AgentAutomationJobSealStorageSchema.safeParse(value);
    return result.success ? result.data : null;
}

export function parseAgentAutomationCoverage(value: unknown): AgentAutomationCoverage | null {
    const result = AgentAutomationCoverageStorageSchema.safeParse(value);
    return result.success ? result.data : null;
}
