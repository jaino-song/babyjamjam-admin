import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "domain/constants/sms-delivery-snapshot";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { AgentAutomationDispatchUncertainError } from "domain/errors/agent-automation-dispatch-uncertain.error";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import { AgentAutomationJobAuthorityService, type CanonicalAutomationRenderer } from "./agent-automation-job-authority.service";
import { agentAutomationConcreteJobDigest } from "./agent-automation-job-binding";
import { MessageAutomationBranchLockService } from "./message-automation-branch-lock.service";
import type { SmsTriggerDeliveryPreparation } from "./sms-trigger-delivery.service";

export type AutomationDeliveryFence = { kind: "allow" } | { kind: "lost" } | { kind: "stale"; reason: string };
type Fence = (transaction: Prisma.TransactionClient) => Promise<AutomationDeliveryFence>;
type Binding = { id: string; branchId: string; claimToken: string; concreteDigest: string; sealDigest: string };
type Admission = { binding: Binding; authority: "allowed" | "legacy" };
type FinalAdmission = Admission & { job: MessageTriggerJobEntity; serializedSnapshot: string; snapshotDigest: string };
const REFUSAL = "문자 동의 또는 발송 대상 확인이 필요합니다";

/**
 * One singleton owns both capabilities. Only its branch-locked transactions can
 * issue them; JSON, a copied preparation, or a rolled-back CAS cannot. No provider
 * or enrichment runs here. All async reads finish before the synchronous take.
 */
@Injectable()
export class AgentAutomationDeliveryGateService {
    private readonly preparationStarted = new WeakSet<MessageTriggerJobEntity>();
    private readonly preparationPermits = new WeakMap<MessageTriggerJobEntity, Admission>();
    private readonly admitted = new WeakMap<MessageTriggerJobEntity, Admission>();
    private readonly finalPermits = new WeakMap<SmsTriggerDeliveryPreparation, FinalAdmission>();

    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE) private readonly database: MessageAutomationDatabase,
        private readonly lock: MessageAutomationBranchLockService,
        private readonly authority: AgentAutomationJobAuthorityService,
    ) {}

    /** Called after generation upsert and before its branch transaction commits. */
    async bindMaterialization(transaction: Prisma.TransactionClient, job: MessageTriggerJobEntity, render: CanonicalAutomationRenderer): Promise<void> {
        const authority = await this.authority.checkAutomaticJob(transaction, job, "materialize", render);
        if (authority.status === "legacy") return;
        if (authority.status === "allowed") {
            job.payload = { ...job.payload, agentAutomationSeal: authority.seal };
        } else {
            job.cancel(REFUSAL);
        }
        const updated = await transaction.message_trigger_job.updateMany({ where: { id: job.id, branchId: job.branchId,
            status: "pending", claimToken: null }, data: { status: job.status, cancelReason: job.cancelReason,
            canceledAt: job.canceledAt, payload: job.payload as unknown as Prisma.InputJsonValue } });
        if (updated.count !== 1) throw new Error("Automation generation changed before binding");
    }

    /** Direct delivery is owned exclusively by the existing finite manual path. */
    async permitsDirectManualJob(job: MessageTriggerJobEntity, status: "processing" | "dispatching" = "dispatching", snapshot?: string): Promise<boolean> {
        if (!isManualMessageTriggerJob(job)
            || Object.prototype.hasOwnProperty.call(job.payload, AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY)) return false;
        try { return await this.matchesStored(this.database, job, this.bind(job), status, snapshot); }
        catch { return false; }
    }

    async authorizePreparation(job: MessageTriggerJobEntity, render: CanonicalAutomationRenderer, fence: Fence): Promise<AutomationDeliveryFence> {
        if (!job.branchId || this.preparationStarted.has(job)) return { kind: "lost" };
        this.preparationStarted.add(job);
        let admission: Admission | undefined;
        const result = await this.lock.runExclusive(job.branchId, async (transaction) => {
            const existing = await fence(transaction);
            if (existing.kind !== "allow") return existing;
            const binding = this.bind(job);
            if (!await this.matchesStored(transaction, job, binding, "processing")) return { kind: "lost" as const };
            const authority = await this.authority.checkAutomaticJob(transaction, job, "dispatch", render);
            if (authority.status === "refused") return this.cancelProcessing(transaction, job);
            admission = { binding, authority: authority.status };
            return { kind: "allow" as const };
        });
        // The transaction promise must resolve before any capability is visible.
        if (result.kind === "allow" && admission) this.preparationPermits.set(job, admission);
        return result;
    }

    async consumePreparation(job: MessageTriggerJobEntity): Promise<boolean> {
        if (isManualMessageTriggerJob(job)) return this.permitsDirectManualJob(job, "processing");
        const permit = this.preparationPermits.get(job);
        if (!permit) return false;
        try {
            if (!await this.matchesStored(this.database, job, permit.binding, "processing")) return false;
            if (this.preparationPermits.get(job) !== permit || !this.matchesCurrent(job, permit.binding)) return false;
            this.preparationPermits.delete(job);
            this.admitted.set(job, permit);
            return true;
        } catch { return false; }
    }

    async authorizeDispatch(job: MessageTriggerJobEntity, preparation: SmsTriggerDeliveryPreparation,
        render: CanonicalAutomationRenderer, compareAndSet: Fence): Promise<AutomationDeliveryFence> {
        const admitted = this.admitted.get(job);
        if (!job.branchId || !admitted) return { kind: "lost" };
        let final: FinalAdmission | undefined;
        const result = await this.lock.runExclusive(job.branchId, async (transaction) => {
            const binding = this.bind(job);
            if (binding.id !== admitted.binding.id || binding.branchId !== admitted.binding.branchId
                || binding.claimToken !== admitted.binding.claimToken
                || (admitted.authority === "allowed" && agentBindingHash(binding) !== agentBindingHash(admitted.binding))) {
                return this.cancelProcessing(transaction, job);
            }
            if (!await this.matchesStored(transaction, job, binding, "processing", preparation.serializedSnapshot)) return { kind: "lost" as const };
            const canonical = await render(job, transaction);
            if (agentBindingHash(canonical) !== agentBindingHash(preparation.snapshot)) return this.cancelProcessing(transaction, job);
            const authority = await this.authority.checkAutomaticJob(transaction, job, "dispatch", render, preparation.snapshot.snapshotHash);
            if (authority.status === "refused" || authority.status !== admitted.authority) return this.cancelProcessing(transaction, job);
            const authorized = await compareAndSet(transaction);
            if (authorized.kind !== "allow") return authorized;
            // A callback returning allow without the actual CAS is not a grant.
            if (!await this.matchesStored(transaction, job, binding, "dispatching", preparation.serializedSnapshot)) {
                throw new AgentAutomationDispatchUncertainError();
            }
            final = { binding, authority: authority.status, job, serializedSnapshot: preparation.serializedSnapshot,
                snapshotDigest: agentBindingHash(preparation.snapshot) };
            return { kind: "allow" as const };
        });
        if (result.kind === "allow" && final && this.admitted.get(job) === admitted) {
            this.admitted.delete(job);
            this.finalPermits.set(preparation, final);
        }
        return result;
    }

    async consumeDispatch(job: MessageTriggerJobEntity, preparation: SmsTriggerDeliveryPreparation): Promise<void> {
        if (isManualMessageTriggerJob(job)
            && await this.permitsDirectManualJob(job, "dispatching", preparation.serializedSnapshot)) return;
        const permit = this.finalPermits.get(preparation);
        if (!permit || permit.job !== job) throw new AgentAutomationDispatchUncertainError();
        try {
            if (!await this.matchesStored(this.database, job, permit.binding, "dispatching", permit.serializedSnapshot)) {
                throw new AgentAutomationDispatchUncertainError();
            }
            // No await may separate this compare-and-delete from provider admission.
            if (this.finalPermits.get(preparation) !== permit || !this.matchesCurrent(job, permit.binding)
                || preparation.serializedSnapshot !== permit.serializedSnapshot
                || agentBindingHash(preparation.snapshot) !== permit.snapshotDigest) throw new AgentAutomationDispatchUncertainError();
            this.finalPermits.delete(preparation);
        } catch { throw new AgentAutomationDispatchUncertainError(); }
    }

    private bind(job: MessageTriggerJobEntity): Binding {
        if (!job.branchId || !job.claimToken) throw new Error("Missing automation claim");
        return { id: job.id, branchId: job.branchId, claimToken: job.claimToken,
            concreteDigest: agentAutomationConcreteJobDigest(job), sealDigest: agentBindingHash(job.payload.agentAutomationSeal) };
    }

    private matchesCurrent(job: MessageTriggerJobEntity, binding: Binding): boolean {
        return agentBindingHash(this.bind(job)) === agentBindingHash(binding);
    }

    private async matchesStored(transaction: Prisma.TransactionClient, job: MessageTriggerJobEntity, binding: Binding,
        status: "processing" | "dispatching", snapshot?: string): Promise<boolean> {
        if (!this.matchesCurrent(job, binding)) return false;
        const row = await transaction.message_trigger_job.findFirst({ where: { id: binding.id, branchId: binding.branchId,
            claimToken: binding.claimToken, status } });
        if (!row || agentAutomationConcreteJobDigest(row) !== binding.concreteDigest) return false;
        const payload = row.payload as Record<string, unknown>;
        return agentBindingHash(payload[AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY]) === binding.sealDigest
            && (snapshot === undefined || (payload["templateVariables"] as Record<string, unknown>)?.[SMS_DELIVERY_SNAPSHOT_VARIABLE] === snapshot);
    }

    private async cancelProcessing(transaction: Prisma.TransactionClient, job: MessageTriggerJobEntity): Promise<AutomationDeliveryFence> {
        const result = await transaction.message_trigger_job.updateMany({ where: { id: job.id, branchId: job.branchId,
            status: "processing", claimToken: job.claimToken }, data: { status: "canceled", cancelReason: REFUSAL,
            canceledAt: new Date(), claimToken: null } });
        return result.count === 1 ? { kind: "stale", reason: REFUSAL } : { kind: "lost" };
    }
}
