import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { AgentAutomationAuthorityService, type AgentAutomationAuthorityCheck, type DescribeCurrentAutomationEffect } from "application/agent/agent-automation-authority.service";
import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY, isReservedAutomationJob } from "domain/constants/agent-automation-storage";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";
import { ClientAutomationSourceReader } from "./client-automation-source.reader";
import { describeClientMessageEffect } from "./client-message-effect-recipe";
import { buildEmployeeAssignmentMessageEffect } from "./employee-assignment-message-effect-recipe";
import {
    describeServiceRecordLinkEffect,
    type ServiceRecordLinkCaseSource,
    type ServiceRecordLinkScheduleSource,
    type ServiceRecordLinkTokenSource,
} from "./service-record-link-automation-effect-recipe";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";
import { agentAutomationConcreteJobDigest, agentAutomationSourcePayload } from "./agent-automation-job-binding";
import { buildClientMessageRecipe, buildEmployeeAssignmentMessageRecipe, buildMessageRecipeDedupeKey } from "./message-trigger-recipes";
import { z } from "zod";

const catchUpSchema = z.object({ batchId: z.string(), sequence: z.number().int().positive(),
    intervalMinutes: z.number().int().nonnegative(), originalScheduledFor: z.iso.datetime(),
    predecessorDedupeKey: z.string().min(1).nullable() }).strict();
type CatchUpMetadata = z.infer<typeof catchUpSchema>;

const MAX_CATCH_UP_PREDECESSOR_CHAIN = 500;
const CATCH_UP_PREDECESSOR_STATUSES = new Set([
    "pending", "processing", "dispatching", "sent", "failed", "canceled",
]);

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
        @Optional()
        private readonly configService?: ConfigService,
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
            const concreteJobDigest = agentAutomationConcreteJobDigest(job);
            // A transient/copied object cannot authorize another row. Materializers
            // insert/upsert, validate, then stamp within their existing transaction.
            const stored = await transaction.message_trigger_job.findFirst({ where: { id: job.id, branchId: job.branchId } });
            if (!stored || isReservedAutomationJob(stored) || agentAutomationConcreteJobDigest(stored) !== concreteJobDigest) return refuse();
            if (mode === "dispatch" && agentBindingHash((stored.payload as Record<string, unknown>)[AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY]) !== agentBindingHash(seal)) return refuse();
            return this.authority.check(transaction, {
                target: { branchId: job.branchId, clientId: job.clientId, kind, ruleId: job.ruleId, scheduleId: job.employeeScheduleId, recipientType },
                mode, seal, concreteJobDigest,
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
        if (input.scope.kind === "employee-assignment") {
            return this.describeCurrentEmployeeAssignmentEffect(transaction, job, input, render, preparedSnapshotHash);
        }
        if (input.scope.kind === "service-record-link") {
            return this.describeCurrentServiceRecordLinkEffect(transaction, job, input, render, preparedSnapshotHash);
        }
        if (input.scope.kind !== "client-rule") return null;
        const settings = await this.sources.readClientAutomationSettings(input.scope.branchId, transaction);
        if (settings.status !== "available") return null;
        const rule = settings.rules.find(({ id, branchId }) => id === input.scope.ruleId && branchId === input.scope.branchId);
        const client = await this.sources.readClientAutomationSource(input.scope.branchId, input.scope.clientId, transaction);
        if (!rule || !client || rule.templateKey !== job.templateKey || rule.recipientType !== job.recipientType) return null;
        // Immediate jobs retain their original materialization time at dispatch.
        // Catch-up jobs retain the raw recipe time plus the final stable batch
        // schedule. Neither is rebuilt from the dispatch wall clock.
        const source = agentAutomationSourcePayload(job.payload);
        const catchUp = source["catchUp"] === undefined ? undefined : catchUpSchema.parse(source["catchUp"]);
        const recipeTime = new Date(catchUp?.originalScheduledFor ?? job.scheduledFor);
        const concrete = buildClientMessageRecipe(rule, client, recipeTime);
        if (!concrete) return null;
        if (catchUp) {
            const prefix = `client:${client.id}:`;
            const batchTime = catchUp.batchId.startsWith(prefix) ? new Date(catchUp.batchId.slice(prefix.length)) : new Date(NaN);
            if (!settings.pastTriggerEnabled || Number.isNaN(batchTime.getTime())
                || catchUp.batchId !== `${prefix}${batchTime.toISOString()}`
                || catchUp.intervalMinutes !== settings.pastTriggerConfig.sendIntervalMinutes
                || catchUp.originalScheduledFor !== concrete.scheduledFor.toISOString()
                || (catchUp.sequence === 1) !== (catchUp.predecessorDedupeKey === null)
                || catchUp.sequence > MAX_CATCH_UP_PREDECESSOR_CHAIN
                || job.scheduledFor.getTime() !== batchTime.getTime() + (catchUp.sequence - 1) * catchUp.intervalMinutes * 60_000) return null;
            if (catchUp.sequence > 1 && !await this.hasCanonicalCatchUpPredecessorChain(
                transaction, job, catchUp, settings.rules, client, batchTime,
            )) return null;
            concrete.scheduledFor = job.scheduledFor;
            concrete.dedupeKey = buildMessageRecipeDedupeKey(rule.id, `client:${client.id}`, job.scheduledFor, rule.recipientType);
            concrete.payload = { ...concrete.payload, catchUp };
        }
        if (job.scheduledFor.getTime() !== concrete.scheduledFor.getTime() || job.dedupeKey !== concrete.dedupeKey
            || job.recipientPhone !== concrete.recipientPhone || agentBindingHash(source) !== agentBindingHash(concrete.payload)) return null;
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

    /**
     * Resolve the dedicated link owner under the caller's transaction. The
     * token service has write-oriented APIs and a non-transactional resolver;
     * this path deliberately reads only the rows needed to prove the exact
     * current assignment and URL, then asks the delivery owner for its snapshot.
     */
    private async describeCurrentEmployeeAssignmentEffect(
        transaction: Prisma.TransactionClient,
        job: MessageTriggerJobEntity,
        input: Parameters<DescribeCurrentAutomationEffect>[0],
        render: CanonicalAutomationRenderer,
        preparedSnapshotHash?: string,
    ) {
        const settings = await this.sources.readClientAutomationSettings(input.scope.branchId, transaction);
        if (settings.status !== "available" || input.scope.scheduleId === null || job.employeeScheduleId !== input.scope.scheduleId) {
            return null;
        }
        const rule = settings.rules.find(({ id, branchId }) => id === input.scope.ruleId && branchId === input.scope.branchId);
        if (!rule) return null;

        // The source reader is branch/client scoped and excludes replaced or
        // terminated schedules. It also carries the immutable incarnation
        // needed to keep numeric schedule-id reuse from inheriting authority.
        const schedules = await this.sources.readClientAutomationSchedules(input.scope.branchId, input.scope.clientId, transaction);
        const schedule = schedules.find(({ id }) => id === input.scope.scheduleId);
        if (!schedule || rule.templateKey !== job.templateKey || rule.recipientType !== job.recipientType) return null;

        const source = agentAutomationSourcePayload(job.payload);
        const concrete = buildEmployeeAssignmentMessageRecipe(rule, schedule, job.scheduledFor);
        if (!concrete || job.scheduledFor.getTime() !== concrete.scheduledFor.getTime()
            || job.dedupeKey !== concrete.dedupeKey || job.recipientPhone !== concrete.recipientPhone
            || agentBindingHash(source) !== agentBindingHash(concrete.payload)) return null;

        const sender = this.sender.read();
        const policy = {
            dispatchEnabled: settings.dispatchEnabled,
            senderApproved: settings.senderApproved,
            senderIdentityDigest: sender.availability === "available" ? sender.identityDigest : null,
            senderApprovedAt: settings.senderApprovedAt?.toISOString() ?? null,
            pastTriggerEnabled: settings.pastTriggerEnabled,
            pastTriggerConfig: settings.pastTriggerConfig,
        };
        let snapshot: Readonly<SmsTriggerDeliverySnapshot>;
        try {
            snapshot = await render(job, transaction);
        } catch {
            // EMPLOYEE_ASSIGNED currently has no generic SMS provider mapping;
            // a future bounded delivery owner may supply one. Until then this
            // path remains fail-closed, just like service-record-link.
            return null;
        }
        if (preparedSnapshotHash !== undefined && snapshot.snapshotHash !== preparedSnapshotHash) return null;
        return buildEmployeeAssignmentMessageEffect({
            branchId: input.scope.branchId,
            subject: input.subject,
            rule,
            schedule,
            scheduleIdentity: input.scope.scheduleIdentity ?? "",
            recipe: concrete,
            snapshot,
            change: input.change,
            policy,
        });
    }


    private async describeCurrentServiceRecordLinkEffect(
        transaction: Prisma.TransactionClient,
        job: MessageTriggerJobEntity,
        input: Parameters<DescribeCurrentAutomationEffect>[0],
        render: CanonicalAutomationRenderer,
        preparedSnapshotHash?: string,
    ) {
        if (input.scope.scheduleId === null || job.employeeScheduleId !== input.scope.scheduleId
            || job.ruleId !== SERVICE_RECORD_LINK_RULE_ID
            || job.recipientType !== MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            || job.templateKey !== MessageTriggerTemplateKey.SERVICE_RECORD_LINK) return null;

        const settings = await this.sources.readClientAutomationSettings(input.scope.branchId, transaction);
        if (settings.status !== "available") return null;
        const rule = settings.rules.find(({ id, branchId }) => id === SERVICE_RECORD_LINK_RULE_ID && branchId === null);
        if (!rule || rule.eventType !== MessageTriggerEventType.SERVICE_START
            || rule.offsetType !== MessageTriggerOffsetType.SAME_DAY || rule.offsetDays !== 0
            || rule.recipientType !== MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            || rule.templateKey !== MessageTriggerTemplateKey.SERVICE_RECORD_LINK || !rule.isActive
            || !settings.dispatchEnabled) return null;

        const schedule = await transaction.employee_schedule.findFirst({
            where: {
                id: input.scope.scheduleId,
                branchId: input.scope.branchId,
                clientId: input.scope.clientId,
                replaced: false,
                terminatedAt: null,
            },
            select: {
                id: true,
                incarnationId: true,
                branchId: true,
                clientId: true,
                startDate: true,
                endDate: true,
                replaced: true,
                terminatedAt: true,
                primaryEmployeeId: true,
                client: {
                    select: {
                        id: true,
                        name: true,
                        branchId: true,
                        createdAt: true,
                        serviceStatus: true,
                    },
                },
                primaryEmployee: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        branchId: true,
                        deletedAt: true,
                    },
                },
            },
        });
        if (!schedule || !schedule.primaryEmployee || !schedule.client) return null;

        // ServiceRecordTokenService.currentProvider selects the latest active
        // assignment for the client. Mirror that check inside this transaction
        // so an older schedule cannot inherit a newer assignment's link.
        const latestSchedule = await transaction.employee_schedule.findFirst({
            where: { branchId: input.scope.branchId, clientId: input.scope.clientId, replaced: false },
            orderBy: { id: "desc" },
            select: { id: true },
        });
        if (!latestSchedule || latestSchedule.id !== schedule.id) return null;

        const serviceRecordCase = await transaction.service_record_case.findFirst({
            where: { branchId: input.scope.branchId, clientId: input.scope.clientId },
            select: {
                id: true,
                branchId: true,
                clientId: true,
                status: true,
                startDate: true,
                endDate: true,
                requiredSessionCount: true,
                formVersion: true,
                version: true,
                finalizedAt: true,
                updatedAt: true,
            },
        });

        const payload = agentAutomationSourcePayload(job.payload);
        const variables = payload["templateVariables"];
        if (!variables || typeof variables !== "object" || Array.isArray(variables)) return null;
        const buttonUrl = payload["buttonUrl"];
        const serviceRecordUrl = (variables as Record<string, unknown>)["serviceRecordUrl"];
        if (typeof buttonUrl !== "string" || typeof serviceRecordUrl !== "string"
            || buttonUrl.length === 0 || buttonUrl !== serviceRecordUrl) return null;

        const tokenValue = this.readServiceRecordLinkToken(buttonUrl);
        if (!tokenValue || !this.matchesConfiguredServiceRecordBase(buttonUrl, tokenValue)) return null;
        const token = await transaction.service_record_token.findFirst({
            where: { branchId: input.scope.branchId, linkTokenHash: tokenValue },
            select: {
                id: true,
                branchId: true,
                scheduleId: true,
                employeeId: true,
                serviceRecordCaseId: true,
                linkTokenHash: true,
                expectedPhoneHash: true,
                expiresAt: true,
                active: true,
                revokedAt: true,
                lockedAt: true,
                failedAttempts: true,
                createdAt: true,
            },
        });
        if (!token) return null;

        let snapshot: Readonly<SmsTriggerDeliverySnapshot>;
        try {
            snapshot = await render(job, transaction);
        } catch {
            return null;
        }
        if (preparedSnapshotHash !== undefined && snapshot.snapshotHash !== preparedSnapshotHash) return null;

        const sender = this.sender.read();
        const policy = {
            dispatchEnabled: settings.dispatchEnabled,
            senderApproved: settings.senderApproved,
            senderIdentityDigest: sender.availability === "available" ? sender.identityDigest : null,
            senderApprovedAt: settings.senderApprovedAt?.toISOString() ?? null,
            pastTriggerEnabled: settings.pastTriggerEnabled,
            pastTriggerConfig: settings.pastTriggerConfig,
        };
        return describeServiceRecordLinkEffect({
            branchId: input.scope.branchId,
            subject: input.subject,
            rule,
            schedule: schedule as ServiceRecordLinkScheduleSource,
            serviceRecordCase: serviceRecordCase as ServiceRecordLinkCaseSource | null,
            token: token as ServiceRecordLinkTokenSource,
            scheduleIdentity: input.scope.scheduleIdentity ?? "",
            serviceRecordUrl,
            sourcePayload: payload,
            scheduledFor: job.scheduledFor,
            dedupeKey: job.dedupeKey,
            snapshot,
            change: input.change,
            policy,
            now: new Date(),
        });
    }

    private readServiceRecordLinkToken(value: string): string | null {
        try {
            const parsed = new URL(value);
            const prefix = "/service-record/";
            if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash
                || !parsed.pathname.startsWith(prefix)) return null;
            const token = parsed.pathname.slice(prefix.length);
            return token && !token.includes("/") ? token : null;
        } catch {
            return null;
        }
    }

    private matchesConfiguredServiceRecordBase(value: string, token: string): boolean {
        const configured = this.configService?.get<string>("MOBILE_SERVICE_RECORD_BASE_URL");
        if (!configured) return true;
        const base = configured.trim().replace(/\/+$/, "");
        return base.length > 0 && value === `${base}/service-record/${token}`;
    }

    private async hasCanonicalCatchUpPredecessorChain(
        transaction: Prisma.TransactionClient,
        job: MessageTriggerJobEntity,
        catchUp: CatchUpMetadata,
        rules: ReadonlyArray<Parameters<typeof buildClientMessageRecipe>[0]>,
        client: Parameters<typeof buildClientMessageRecipe>[1],
        batchTime: Date,
    ): Promise<boolean> {
        if (catchUp.sequence <= 1 || !catchUp.predecessorDedupeKey) return false;

        const intervalMs = catchUp.intervalMinutes * 60_000;
        let expectedSequence = catchUp.sequence - 1;
        let expectedDedupeKey: string | null = catchUp.predecessorDedupeKey;
        const clientScope = `client:${client.id}`;

        while (expectedSequence >= 1 && expectedDedupeKey) {
            const predecessor = await transaction.message_trigger_job.findUnique({
                where: { dedupeKey: expectedDedupeKey },
                select: {
                    id: true,
                    branchId: true,
                    ruleId: true,
                    status: true,
                    scheduledFor: true,
                    sentAt: true,
                    canceledAt: true,
                    clientId: true,
                    employeeScheduleId: true,
                    recipientType: true,
                    recipientPhone: true,
                    templateKey: true,
                    dedupeKey: true,
                    payload: true,
                },
            });
            if (!predecessor
                || isReservedAutomationJob(predecessor)
                || isManualMessageTriggerJob(predecessor)
                || !CATCH_UP_PREDECESSOR_STATUSES.has(predecessor.status)
                || predecessor.branchId !== job.branchId
                || predecessor.clientId !== job.clientId
                || predecessor.employeeScheduleId !== job.employeeScheduleId
                || (predecessor.status === "sent" && predecessor.sentAt === null)
                || (predecessor.status === "canceled" && predecessor.canceledAt === null)
                || (["pending", "processing", "dispatching"].includes(predecessor.status)
                    && (predecessor.sentAt !== null || predecessor.canceledAt !== null))) return false;

            const predecessorSource = agentAutomationSourcePayload(predecessor.payload);
            const parsed = catchUpSchema.safeParse(predecessorSource["catchUp"]);
            if (!parsed.success) return false;
            const predecessorCatchUp = parsed.data;
            const predecessorRule = rules.find(({ id, branchId }) => id === predecessor.ruleId && branchId === job.branchId);
            if (!predecessorRule || predecessor.recipientType !== predecessorRule.recipientType
                || predecessor.templateKey !== predecessorRule.templateKey) return false;
            const predecessorRecipeTime = new Date(predecessorCatchUp.originalScheduledFor);
            const predecessorConcrete = buildClientMessageRecipe(predecessorRule, client, predecessorRecipeTime);
            if (!predecessorConcrete) return false;
            const expectedScheduledFor = new Date(batchTime.getTime() + (expectedSequence - 1) * intervalMs);
            if (predecessorCatchUp.batchId !== catchUp.batchId
                || predecessorCatchUp.sequence !== expectedSequence
                || predecessorCatchUp.intervalMinutes !== catchUp.intervalMinutes
                || predecessorCatchUp.originalScheduledFor !== predecessorConcrete.scheduledFor.toISOString()
                || predecessor.scheduledFor.getTime() !== expectedScheduledFor.getTime()
                || predecessor.dedupeKey !== buildMessageRecipeDedupeKey(predecessorRule.id, clientScope, expectedScheduledFor, predecessorRule.recipientType)
                || predecessor.recipientPhone !== predecessorConcrete.recipientPhone
                || agentBindingHash(predecessorSource) !== agentBindingHash({ ...predecessorConcrete.payload, catchUp: predecessorCatchUp })) return false;

            if (expectedSequence === 1) return predecessorCatchUp.predecessorDedupeKey === null;
            if (!predecessorCatchUp.predecessorDedupeKey) return false;
            expectedDedupeKey = predecessorCatchUp.predecessorDedupeKey;
            expectedSequence -= 1;
        }

        return false;
    }
}
