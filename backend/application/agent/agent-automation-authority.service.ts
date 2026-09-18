import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AgentAutomationEffect, AgentAutomationJobSeal, AgentAutomationScope, AgentAutomationTaskCommitReference } from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import type { ClientMessageLogicalSubject } from "application/services/client-message-effect-recipe";
import { AgentAutomationRecordStoreService } from "./agent-automation-record-store.service";
import { agentAutomationEffectDigest, agentAutomationScheduleIdentity, resolveAgentAutomationAuthority } from "./agent-automation-consent";
import { agentAutomationCoverageScope, agentAutomationGrandfatheredFingerprint, resolveAgentAutomationCoverageHead } from "./agent-automation-coverage";
import { AgentAutomationEffectStorageSchema, AgentAutomationScopeStorageSchema, parseAgentAutomationJobSeal } from "./agent-automation-storage.schema";

export type AgentAutomationCurrentTarget = Omit<AgentAutomationScope, "clientIdentity" | "scheduleIdentity">;
export type AgentAutomationAuthorityCheck =
    | { status: "legacy" }
    | { status: "allowed"; seal: AgentAutomationJobSeal }
    | { status: "refused"; reason: "automation-authority-unavailable" | "automation-consent-denied" | "automation-consent-changed" };

/** The source owner reads current rule/recipient/template/policy under the supplied transaction. */
export type DescribeCurrentAutomationEffect = (input: {
    scope: AgentAutomationScope;
    subject: ClientMessageLogicalSubject;
    change: AgentAutomationEffect["change"];
}) => Promise<AgentAutomationEffect | null>;

/**
 * Internal resolver, not a public permission endpoint. Callers hold the existing
 * branch automation lock and keep it through generation/dispatch CAS. The recipe
 * callback belongs to the source owner; neither a model nor job JSON supplies it.
 * This service performs no provider, enrichment, source write or independent TX.
 */
@Injectable()
export class AgentAutomationAuthorityService {
    constructor(private readonly records: AgentAutomationRecordStoreService) {}

    async check(
        transaction: Prisma.TransactionClient,
        input: { target: AgentAutomationCurrentTarget; mode: "materialize" | "dispatch"; concreteJobDigest: string; seal?: unknown; taskReference?: AgentAutomationTaskCommitReference },
        describe: DescribeCurrentAutomationEffect,
    ): Promise<AgentAutomationAuthorityCheck> {
        const refuse = (reason: Extract<AgentAutomationAuthorityCheck, { status: "refused" }>["reason"] = "automation-authority-unavailable"): AgentAutomationAuthorityCheck => ({ status: "refused", reason });
        try {
            if (input.mode !== "materialize" && input.mode !== "dispatch") return refuse();
            if (!/^[a-f0-9]{64}$/.test(input.concreteJobDigest)) return refuse();
            const suppliedSeal = input.seal === undefined ? undefined : parseAgentAutomationJobSeal(input.seal);
            if (suppliedSeal === null) return refuse();
            const { target } = input;
            const client = await transaction.client.findFirst({ where: { id: target.clientId, branchId: target.branchId }, select: { id: true, createdAt: true } });
            if (!client?.createdAt) return refuse();
            const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: client.id, createdAt: client.createdAt.toISOString() });
            const schedule = target.scheduleId === null ? null : await transaction.employee_schedule.findFirst({
                where: { id: target.scheduleId, clientId: client.id, branchId: target.branchId }, select: { incarnationId: true, replaced: true, terminatedAt: true },
            });
            if (target.scheduleId !== null && (!schedule || schedule.replaced || schedule.terminatedAt)) return refuse();
            const scope = AgentAutomationScopeStorageSchema.parse({ ...target, clientIdentity,
                scheduleIdentity: schedule ? agentAutomationScheduleIdentity(schedule.incarnationId) : null });
            const { batch, creationSubjects } = await this.records.readLineageEvidence(transaction, scope);
            // An ordinary successor deliberately supersedes the task record for
            // this exact scope. Require the task carrier only while the current
            // effective head is still task-rooted; historical task rows remain
            // part of the chain but must not block an explicitly authorized
            // ordinary replacement or force a new materialized row to copy a
            // transient intent carrier.
            const effectiveHead = batch.authorities.at(-1) ?? batch.coverages.at(-1);
            const taskHead = effectiveHead?.origin.kind === "task";
            if (taskHead && !input.taskReference) return refuse();
            if (input.taskReference) {
                // Authority references bind the exact operation scope, while a
                // coverage reference deliberately omits ruleId. A coverage
                // carrier is therefore matched against the canonical coverage
                // scope here; the exact rule is checked below by the
                // grandfathered scope and fingerprint resolver.
                const exactScopeDigest = agentBindingHash(scope);
                const coverageScopeDigest = agentBindingHash(agentAutomationCoverageScope(scope));
                const authorityReferenceBound = input.taskReference.authorities
                    .some((reference) => reference.scopeDigest === exactScopeDigest);
                const coverageReferenceBound = input.taskReference.coverages
                    .some((reference) => reference.scopeDigest === coverageScopeDigest);
                const expectedReferenceBound = batch.authorities.length > 0
                    ? authorityReferenceBound
                    : coverageReferenceBound;
                // A valid ordinary successor owns the current scope. Its job
                // may still carry a preserved task carrier from an earlier
                // materialization, but that transient pointer must not keep a
                // superseded task record alive or block the ordinary head after
                // task retention/purge. Scope binding is still checked so a
                // copied carrier cannot cross into another operation.
                if (!expectedReferenceBound
                    || (taskHead && !await this.records.verifyTaskCommitReference(transaction, input.taskReference, scope.branchId))) return refuse();
            }
            const coverage = resolveAgentAutomationCoverageHead({ records: batch.coverages, scope: agentAutomationCoverageScope(scope), knownProvenance: batch.coverages.length > 0 });
            if (coverage.status === "refused") return refuse();
            if (!batch.authorities.length) {
                // An orphaned seal never becomes evidence that the scope was legacy.
                if (suppliedSeal) return refuse();
                if (coverage.status === "absent") return { status: "legacy" };
                const current = await describe({ scope: { ...scope }, subject: { kind: "client", clientId: client.id, clientIdentity }, change: "create" });
                if (!current) return refuse();
                const effect = AgentAutomationEffectStorageSchema.parse(current);
                if (!this.matchesScope(effect, scope)) return refuse();
                const fingerprint = agentAutomationGrandfatheredFingerprint(effect);
                return coverage.coverage.grandfatheredScopes.some((member) => agentBindingHash(member.scope) === agentBindingHash(scope)
                    && member.fingerprint === fingerprint) ? { status: "legacy" } : refuse("automation-consent-denied");
            }
            // Coverage is mandatory for task-created exact authority. It cannot
            // be removed while leaving an otherwise well-formed exact row.
            if (coverage.status !== "head") return refuse();
            const head = batch.authorities.at(-1)!;
            if (head.decision !== "allow" || head.noSend) return refuse("automation-consent-denied");
            if (head.effects.length !== 1) return refuse();
            const creation = creationSubjects.find(({ authorityId }) => authorityId === head.id);
            const subject: ClientMessageLogicalSubject = creation ? { kind: "task-client", taskId: creation.taskId }
                : { kind: "client", clientId: client.id, clientIdentity };
            const current = await describe({ scope: { ...scope }, subject, change: head.effects[0]!.change });
            if (!current) return refuse();
            const effect = AgentAutomationEffectStorageSchema.parse(current);
            if (!this.matchesScope(effect, scope)) return refuse();
            const resolution = resolveAgentAutomationAuthority({ records: batch.authorities, scope, effect,
                currentScopeEffectDigest: agentAutomationEffectDigest([effect]), knownTaskOrigin: true });
            if (resolution.status !== "allowed") return refuse("automation-consent-changed");
            const seal: AgentAutomationJobSeal = { version: 1, authorityId: head.id, authorityDigest: head.recordDigest, scope,
                memberDigest: agentAutomationEffectDigest([effect]), reviewedEffectDigest: head.reviewedEffectDigest,
                concreteJobDigest: input.concreteJobDigest };
            if (suppliedSeal && agentBindingHash(suppliedSeal) !== agentBindingHash(seal)) return refuse("automation-consent-changed");
            if (input.mode === "dispatch" && !suppliedSeal) return refuse();
            return { status: "allowed", seal };
        } catch {
            // Database/renderer failures do not imply legacy behavior or expose PII.
            return refuse();
        }
    }

    private matchesScope(effect: AgentAutomationEffect, scope: AgentAutomationScope): boolean {
        return effect.kind === scope.kind && effect.ruleId === scope.ruleId && effect.scheduleId === scope.scheduleId
            && effect.recipientType === scope.recipientType;
    }
}
