import { z } from "zod";
import { AgentAutomationEffectSummarySchema } from "@babyjamjam/shared";
import type { AgentAutomationAuthority, AgentAutomationJobSeal } from "domain/entities/agent-automation-consent";
import { agentAutomationEffectDigest, agentAutomationRecordDigest } from "./agent-automation-consent";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const AgentAutomationEffectStorageSchema = AgentAutomationEffectSummarySchema
    .omit({ effectRef: true, recipientRef: true })
    .extend({
        ruleId: z.string().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/),
        scheduleId: positiveId.nullable(),
        recipientDigest: digest, sourceDigest: digest, templateDigest: digest, policyDigest: digest, recipeDigest: digest,
    }).strict().superRefine((effect, context) => {
        if ((effect.kind === "client-rule") !== (effect.scheduleId === null)
            || (effect.kind === "client-rule" && effect.recipientType !== "client")) {
            context.addIssue({ code: "custom", message: "Inconsistent automation effect target" });
        }
    });

export const AgentAutomationScopeStorageSchema = z.object({
    branchId: z.uuid(), clientId: positiveId, clientIdentity: digest,
    kind: AgentAutomationEffectSummarySchema.shape.kind, scheduleId: positiveId.nullable(),
}).strict().superRefine((scope, context) => {
    if ((scope.kind === "client-rule") !== (scope.scheduleId === null)) {
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
            || record.effects.some((effect) => effect.kind !== record.scope.kind || effect.scheduleId !== record.scope.scheduleId)
            || (record.decision === "allow" && (record.noSend || !record.effects.length
                || (record.origin.kind === "task" && !record.origin.consentEventId)))
            || (record.decision === "none" && record.effects.length !== 0)) {
            context.addIssue({ code: "custom", message: "Invalid automation authority binding" });
        }
    } catch {
        context.addIssue({ code: "custom", message: "Ambiguous automation authority effects" });
    }
});

export const AgentAutomationJobSealStorageSchema = z.object({
    version: z.literal(1), authorityId: z.uuid(), authorityDigest: digest,
    scope: AgentAutomationScopeStorageSchema, memberDigest: digest, reviewedEffectDigest: digest,
}).strict();

/** Private committed association; never included in a capability's public result. */
export const AgentAutomationReceiptMetadataSchema = z.object({
    version: z.literal(1), taskId: z.uuid(), taskRevision: positiveId, questionRef: z.uuid(),
    reviewedEffectDigest: digest, reviewedPolicyDigest: digest,
    authorities: z.array(z.object({ id: z.uuid(), recordDigest: digest, scopeDigest: digest }).strict()).min(1).max(500),
}).strict().superRefine((metadata, context) => {
    if (new Set(metadata.authorities.map(({ id }) => id)).size !== metadata.authorities.length
        || new Set(metadata.authorities.map(({ scopeDigest }) => scopeDigest)).size !== metadata.authorities.length) {
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
