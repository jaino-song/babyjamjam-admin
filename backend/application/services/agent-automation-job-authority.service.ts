import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AgentAutomationAuthorityService, type AgentAutomationAuthorityCheck, type DescribeCurrentAutomationEffect } from "application/agent/agent-automation-authority.service";
import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY, isReservedAutomationJob } from "domain/constants/agent-automation-storage";
import { MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";
import { ClientAutomationSourceReader } from "./client-automation-source.reader";
import { describeClientMessageEffect } from "./client-message-effect-recipe";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";

export type CanonicalAutomationRenderer = (job: MessageTriggerJobEntity, transaction: Prisma.TransactionClient) => Promise<Readonly<SmsTriggerDeliverySnapshot>>;

/**
 * Reads the actual source recipe for the authority resolver. The delivery owner
 * supplies its canonical renderer, avoiding a trigger/delivery dependency cycle.
 * Callers retain the branch lock through job generation or final dispatch CAS.
 * This adapter does not stamp jobs, persist cancellation, or send a message.
 */
@Injectable()
export class AgentAutomationJobAuthorityService {
    constructor(
        private readonly authority: AgentAutomationAuthorityService,
        private readonly sources: ClientAutomationSourceReader,
        private readonly sender: AligoDefaultSenderPolicyService,
    ) {}

    async checkAutomaticJob(
        transaction: Prisma.TransactionClient,
        job: MessageTriggerJobEntity,
        mode: "materialize" | "dispatch",
        render: CanonicalAutomationRenderer,
        preparedSnapshotHash?: string,
    ): Promise<AgentAutomationAuthorityCheck> {
        const refuse = (): AgentAutomationAuthorityCheck => ({ status: "refused", reason: "automation-authority-unavailable" });
        try {
            if (isReservedAutomationJob(job) || isManualMessageTriggerJob(job) || !job.branchId || !job.clientId) return refuse();
            const recipientType = job.recipientType === MessageTriggerRecipientType.CLIENT ? "client"
                : job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE ? "primary-employee"
                    : job.recipientType === MessageTriggerRecipientType.SECONDARY_EMPLOYEE ? "secondary-employee" : null;
            if (!recipientType) return refuse();
            const kind = job.ruleId === SERVICE_RECORD_LINK_RULE_ID ? "service-record-link"
                : job.employeeScheduleId === null ? "client-rule" : "employee-assignment";
            const payload = job.payload as unknown as Record<string, unknown>;
            const seal = Object.prototype.hasOwnProperty.call(payload, AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY)
                ? payload[AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY] : undefined;
            return this.authority.check(transaction, {
                target: { branchId: job.branchId, clientId: job.clientId, kind, ruleId: job.ruleId, scheduleId: job.employeeScheduleId, recipientType },
                mode, seal,
            }, async (input) => this.describeCurrentClientEffect(transaction, job, input, render, preparedSnapshotHash));
        } catch {
            return refuse();
        }
    }

    private async describeCurrentClientEffect(
        transaction: Prisma.TransactionClient,
        job: MessageTriggerJobEntity,
        input: Parameters<DescribeCurrentAutomationEffect>[0],
        render: CanonicalAutomationRenderer,
        preparedSnapshotHash?: string,
    ) {
        // Dedicated schedule/link owners require their bounded recipe adapters;
        // a known task scope cannot acquire authority from a generic substitute.
        if (input.scope.kind !== "client-rule") return null;
        const settings = await this.sources.readClientAutomationSettings(input.scope.branchId, transaction);
        if (settings.status !== "available") return null;
        const rule = settings.rules.find(({ id, branchId }) => id === input.scope.ruleId && branchId === input.scope.branchId);
        const client = await this.sources.readClientAutomationSource(input.scope.branchId, input.scope.clientId, transaction);
        if (!rule || !client || rule.templateKey !== job.templateKey || rule.recipientType !== job.recipientType) return null;
        const sender = this.sender.read();
        const described = await describeClientMessageEffect({ branchId: input.scope.branchId, subject: input.subject,
            rule, client, change: input.change, now: new Date(), policy: {
                dispatchEnabled: settings.dispatchEnabled, senderApproved: settings.senderApproved,
                senderIdentityDigest: sender.availability === "available" ? sender.identityDigest : null,
                senderApprovedAt: settings.senderApprovedAt?.toISOString() ?? null,
                pastTriggerEnabled: settings.pastTriggerEnabled, pastTriggerConfig: settings.pastTriggerConfig,
            }, delivery: { resolveCanonicalDeliverySnapshot: async (currentJob) => {
                const current = await render(currentJob, transaction);
                const candidate = await render(job, transaction);
                if (current.snapshotHash !== candidate.snapshotHash
                    || (preparedSnapshotHash !== undefined && candidate.snapshotHash !== preparedSnapshotHash)) {
                    throw new Error("Automation job no longer matches its current source");
                }
                return current;
            } } });
        return described.status === "effect" ? described.effect : null;
    }
}
