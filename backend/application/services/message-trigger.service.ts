import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    EVENT_OFFSET_OPTIONS,
    EVENT_RECIPIENT_OPTIONS,
    getMessageTriggerTemplateCatalog,
    isCompatibleMessageTriggerTemplate,
    type SupportedTriggerProvider,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import {
    MESSAGE_TRIGGER_RULE_REPOSITORY,
    IMessageTriggerRuleRepository,
} from "domain/repositories/message-trigger-rule.repository.interface";
import {
    MESSAGE_TRIGGER_JOB_REPOSITORY,
    IMessageTriggerJobRepository,
} from "domain/repositories/message-trigger-job.repository.interface";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { MessageTriggerDeliveryService } from "./message-trigger-delivery.service";
import { hasColumn, hasTable } from "infrastructure/database/schema-capabilities";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import { buildSmsClientVariables } from "./sms-client-variables";

interface UpsertRuleParams {
    name: string;
    isActive?: boolean;
    eventType: MessageTriggerEventType;
    offsetType: MessageTriggerOffsetType;
    offsetDays?: number;
    recipientType: MessageTriggerRecipientType;
    templateKey: MessageTriggerTemplateKey;
}

const DEFAULT_SERVICE_INFO_TRIGGER: UpsertRuleParams = {
    name: "서비스 시작 7일 전 서비스 안내",
    isActive: true,
    eventType: MessageTriggerEventType.SERVICE_START,
    offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
    offsetDays: 7,
    recipientType: MessageTriggerRecipientType.CLIENT,
    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
};

const DEFAULT_CLIENT_GREETING_TRIGGER: UpsertRuleParams = {
    name: "신규 고객 인사 메시지",
    isActive: true,
    eventType: MessageTriggerEventType.CLIENT_CREATED,
    offsetType: MessageTriggerOffsetType.IMMEDIATE,
    offsetDays: 0,
    recipientType: MessageTriggerRecipientType.CLIENT,
    templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
};

export interface UpcomingMessageTriggerJobView {
    id: string;
    ruleId: string;
    ruleName: string;
    eventType: MessageTriggerEventType | null;
    offsetType: MessageTriggerOffsetType | null;
    offsetDays: number;
    recipientType: MessageTriggerRecipientType;
    recipientPhone: string | null;
    templateKey: MessageTriggerTemplateKey;
    status: string;
    scheduledFor: Date;
    sentAt: Date | null;
    canceledAt: Date | null;
    cancelReason: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
    payload: MessageTriggerJobEntity["payload"];
    createdAt: Date;
    updatedAt: Date;
}

export interface MessageLogRecordView {
    id: number;
    provider: string;
    templateKey: string;
    triggerJobId: string | null;
    receiver: string;
    clientId: number | null;
    messageBody: string;
    variables: Record<string, string>;
    status: MessageLogEntity["status"];
    aligoMid: string | null;
    errorMessage: string | null;
    attempts: number;
    lastAttemptAt: Date | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    ruleId: string | null;
    ruleName: string | null;
    eventType: MessageTriggerEventType | null;
    offsetType: MessageTriggerOffsetType | null;
    offsetDays: number;
    scheduledFor: Date | null;
    recipientType: MessageTriggerRecipientType | null;
    recipientName: string | null;
    clientName: string | null;
    employeeName: string | null;
}

interface ClientTriggerSource {
    id: number;
    name: string;
    phone: string | null;
    type: string | null;
    startDate: Date | null;
    endDate: Date | null;
    createdAt?: Date | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
}

@Injectable()
export class MessageTriggerService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly deliveryService: MessageTriggerDeliveryService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly ruleRepository: IMessageTriggerRuleRepository,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository: IMessageTriggerJobRepository,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
    ) {}

    async listRules(branchId: string): Promise<MessageTriggerRuleEntity[]> {
        if (!(await this.hasTriggerSchema())) {
            return [];
        }
        const rules = await this.ruleRepository.findAll(branchId);
        return this.ensureDefaultServiceInfoTrigger(branchId, rules);
    }

    async ensureDefaultRulesForBranch(branchId: string): Promise<void> {
        if (!(await this.hasTriggerSchema())) return;
        const rules = await this.ruleRepository.findAll(branchId);
        await this.ensureDefaultServiceInfoTrigger(branchId, rules);
    }

    async listUpcomingJobs(
        branchId: string,
        limit = 200,
    ): Promise<UpcomingMessageTriggerJobView[]> {
        if (!(await this.hasTriggerSchema())) {
            return [];
        }

        const jobs = await this.jobRepository.findUpcomingPendingByBranch(branchId, limit);
        if (jobs.length === 0) {
            return [];
        }

        const rules = await this.ruleRepository.findAll(branchId);
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        return jobs.map((job) => {
            const rule = rulesById.get(job.ruleId);

            return {
                id: job.id,
                ruleId: job.ruleId,
                ruleName: rule?.name ?? "알 수 없는 규칙",
                eventType: rule?.eventType ?? null,
                offsetType: rule?.offsetType ?? null,
                offsetDays: rule?.offsetDays ?? 0,
                recipientType: job.recipientType,
                recipientPhone: job.recipientPhone,
                templateKey: job.templateKey,
                status: job.status,
                scheduledFor: job.scheduledFor,
                sentAt: job.sentAt,
                canceledAt: job.canceledAt,
                cancelReason: job.cancelReason,
                clientId: job.clientId,
                employeeScheduleId: job.employeeScheduleId,
                payload: job.payload,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            };
        });
    }

    async listHistory(
        branchId: string,
        limit = 200,
        skip = 0,
    ): Promise<MessageLogRecordView[]> {
        if (!(await hasTable(this.prisma, "message_log"))) {
            return [];
        }

        const logs = await this.logRepository.findRecentByBranch(branchId, limit, skip);
        if (logs.length === 0) {
            return [];
        }

        const triggerJobIds = logs
            .map((log) => log.triggerJobId)
            .filter((id): id is string => !!id);

        const jobs = triggerJobIds.length > 0
            ? await this.prisma.message_trigger_job.findMany({
                where: { id: { in: triggerJobIds } },
                select: {
                    id: true,
                    ruleId: true,
                    scheduledFor: true,
                    recipientType: true,
                    payload: true,
                },
            })
            : [];

        const jobsById = new Map(jobs.map((job) => [job.id, job]));
        const rules = await this.ruleRepository.findAll(branchId);
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        return logs.map((log) => {
            const job = log.triggerJobId ? jobsById.get(log.triggerJobId) : null;
            const payload = (job?.payload as MessageTriggerJobEntity["payload"] | undefined) ?? null;
            const rule = job ? rulesById.get(job.ruleId) ?? null : null;

            return {
                id: log.id,
                provider: log.provider,
                templateKey: log.templateKey,
                triggerJobId: log.triggerJobId,
                receiver: log.receiver,
                clientId: log.clientId,
                messageBody: log.messageBody,
                variables: log.variables,
                status: log.status,
                aligoMid: log.aligoMid,
                errorMessage: log.errorMessage,
                attempts: log.attempts,
                lastAttemptAt: log.lastAttemptAt,
                nextRetryAt: log.nextRetryAt,
                createdAt: log.createdAt,
                updatedAt: log.updatedAt,
                ruleId: job?.ruleId ?? null,
                ruleName: rule?.name ?? null,
                eventType: rule?.eventType ?? null,
                offsetType: rule?.offsetType ?? null,
                offsetDays: rule?.offsetDays ?? 0,
                scheduledFor: job?.scheduledFor ?? null,
                recipientType: (job?.recipientType as MessageTriggerRecipientType | undefined) ?? null,
                recipientName: payload?.recipientName ?? null,
                clientName: payload?.clientName ?? null,
                employeeName: payload?.employeeName ?? null,
            };
        });
    }

    async getRule(branchId: string, id: string): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        const rule = await this.ruleRepository.findById(branchId, id);
        if (!rule) {
            throw new NotFoundException(`Trigger rule ${id} not found`);
        }
        return rule;
    }

    listTemplates(params: {
        provider: SupportedTriggerProvider;
        eventType?: MessageTriggerEventType;
        recipientType?: MessageTriggerRecipientType;
    }) {
        return getMessageTriggerTemplateCatalog(params.provider).filter((item) => {
            if (params.eventType && !item.allowedEventTypes.includes(params.eventType)) return false;
            if (
                params.recipientType &&
                !item.allowedRecipientTypes.includes(params.recipientType)
            ) {
                return false;
            }
            return true;
        });
    }

    async createRule(
        branchId: string,
        params: UpsertRuleParams,
    ): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        this.validateRule(params);
        const rule = await this.ruleRepository.create(
            branchId,
            MessageTriggerRuleEntity.create({
                branchId,
                ...params,
                offsetDays: this.normalizeOffsetDays(params.offsetType, params.offsetDays),
            }),
        );
        if (rule.isActive) {
            await this.rebuildJobsForRule(branchId, rule, false);
        }
        return rule;
    }

    async updateRule(
        branchId: string,
        id: string,
        params: Partial<UpsertRuleParams>,
    ): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        const rule = await this.getRule(branchId, id);
        const nextState: UpsertRuleParams = {
            name: params.name ?? rule.name,
            isActive: params.isActive ?? rule.isActive,
            eventType: params.eventType ?? rule.eventType,
            offsetType: params.offsetType ?? rule.offsetType,
            offsetDays: params.offsetDays ?? rule.offsetDays,
            recipientType: params.recipientType ?? rule.recipientType,
            templateKey: params.templateKey ?? rule.templateKey,
        };

        this.validateRule(nextState);
        rule.update({
            ...nextState,
            offsetDays: this.normalizeOffsetDays(nextState.offsetType, nextState.offsetDays),
        });
        const updated = await this.ruleRepository.update(branchId, rule);
        await this.cancelPendingJobsForRule(updated.id, "Rule updated");
        if (updated.isActive) {
            await this.rebuildJobsForRule(branchId, updated, false);
        }
        return updated;
    }

    async deleteRule(branchId: string, id: string): Promise<void> {
        await this.ensureTriggerSchemaReady();
        await this.getRule(branchId, id);
        await this.cancelPendingJobsForRule(id, "Rule deleted");
        await this.ruleRepository.delete(branchId, id);
    }

    async dispatchDueJobs(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }
        const jobs = await this.jobRepository.findDuePending(100);
        for (const job of jobs) {
            const sent = await this.deliveryService.sendJob(job).catch((error) => {
                job.markFailed(error instanceof Error ? error.message : String(error));
                return false;
            });

            if (sent) {
                job.markSent();
            } else if (job.status === "pending") {
                job.markFailed("Provider disabled or delivery failed");
            }
            await this.jobRepository.update(job);
        }
    }

    async syncClientRulesForClient(
        branchId: string,
        clientId: number,
        includePast: boolean,
        suppressGreeting = false,
    ): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        const supportsCreatedAt = await hasColumn(this.prisma, "client", "created_at");
        const supportsAreaId = await hasColumn(this.prisma, "client", "area_id");
        // Prisma's type inference does not correctly narrow the `area` relation type when
        // the select key is inside a conditional spread; cast to ClientTriggerSource explicitly.
        const client = await this.prisma.client.findFirst({
            where: { id: clientId, branchId },
            select: {
                id: true,
                name: true,
                phone: true,
                type: true,
                startDate: true,
                endDate: true,
                duration: true,
                fullPrice: true,
                grant: true,
                actualPrice: true,
                ...(supportsAreaId ? { area: { select: { bankAccountInfo: { select: { bankName: true, accNum: true } } } } } : {}),
                ...(supportsCreatedAt ? { createdAt: true } : {}),
            },
        }) as ClientTriggerSource | null;
        if (!client) return;

        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, [
            MessageTriggerEventType.CLIENT_CREATED,
            MessageTriggerEventType.SERVICE_START,
            MessageTriggerEventType.SERVICE_END,
        ]);

        await this.cancelPendingJobsForClient(rules.map((rule) => rule.id), clientId, "Client data changed");

        for (const rule of rules) {
            if (rule.eventType === MessageTriggerEventType.CLIENT_CREATED && !supportsCreatedAt) {
                continue;
            }
            if (rule.templateKey === MessageTriggerTemplateKey.CLIENT_GREETING && suppressGreeting) {
                continue;
            }
            const job = this.buildClientJob(rule, client);
            await this.persistPendingJob(job, rule, includePast);
        }
    }

    async syncEmployeeAssignmentRulesForSchedule(
        branchId: string,
        employeeScheduleId: number,
        includePast: boolean,
    ): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: employeeScheduleId, branchId },
            include: {
                client: true,
                primaryEmployee: true,
                secondaryEmployee: true,
            },
        });
        if (!schedule) return;

        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, [
            MessageTriggerEventType.EMPLOYEE_ASSIGNED,
        ]);

        await this.cancelPendingJobsForEmployeeSchedule(
            rules.map((rule) => rule.id),
            employeeScheduleId,
            "Employee assignment changed",
        );

        for (const rule of rules) {
            const job = this.buildEmployeeAssignmentJob(rule, schedule);
            await this.persistPendingJob(job, rule, includePast);
        }
    }

    async hasActiveRulesForEvents(
        branchId: string,
        eventTypes: MessageTriggerEventType[],
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, eventTypes);
        return rules.length > 0;
    }

    private async ensureDefaultTrigger(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        defaults: UpsertRuleParams,
        matchTemplateKeyOnly = false,
    ): Promise<{ rules: MessageTriggerRuleEntity[]; created: MessageTriggerRuleEntity | null }> {
        // For IMMEDIATE-greeting-style defaults, ANY existing rule with the same templateKey
        // counts as "the default already exists". Otherwise an admin-created greeting rule with
        // a non-default offset (e.g. AFTER_DAYS) would not match the full tuple, the IMMEDIATE
        // default would be auto-created on next panel load, and the client would get two
        // greetings per registration.
        const existing = matchTemplateKeyOnly
            ? rules.find((rule) => rule.templateKey === defaults.templateKey)
            : rules.find((rule) => (
                rule.eventType === defaults.eventType &&
                rule.offsetType === defaults.offsetType &&
                rule.offsetDays === (defaults.offsetDays ?? 0) &&
                rule.recipientType === defaults.recipientType &&
                rule.templateKey === defaults.templateKey
            ));
        if (existing) return { rules, created: null };

        const created = await this.ruleRepository.create(
            branchId,
            MessageTriggerRuleEntity.create({
                branchId,
                ...defaults,
            }),
        );
        await this.rebuildJobsForRule(branchId, created, false);
        return { rules: [created, ...rules], created };
    }

    private async ensureDefaultServiceInfoTrigger(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
    ): Promise<MessageTriggerRuleEntity[]> {
        if (!branchId) return rules;

        const { rules: rulesAfterServiceInfo } = await this.ensureDefaultTrigger(
            branchId,
            rules,
            DEFAULT_SERVICE_INFO_TRIGGER,
        );

        const { rules: finalRules } = await this.ensureDefaultTrigger(
            branchId,
            rulesAfterServiceInfo,
            DEFAULT_CLIENT_GREETING_TRIGGER,
            true,
        );

        return finalRules;
    }

    private async rebuildJobsForRule(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        includePast: boolean,
    ): Promise<void> {
        if (!rule.isActive) return;

        if (rule.eventType === MessageTriggerEventType.EMPLOYEE_ASSIGNED) {
            return;
        }

        if (rule.offsetType === MessageTriggerOffsetType.IMMEDIATE) return;

        const supportsCreatedAt = await hasColumn(this.prisma, "client", "created_at");
        if (rule.eventType === MessageTriggerEventType.CLIENT_CREATED && !supportsCreatedAt) {
            return;
        }

        const supportsAreaId = await hasColumn(this.prisma, "client", "area_id");
        // Prisma's type inference does not correctly narrow the `area` relation type when
        // the select key is inside a conditional spread; cast to ClientTriggerSource[] explicitly.
        const clients = await this.prisma.client.findMany({
            where: { branchId },
            select: {
                id: true,
                name: true,
                phone: true,
                type: true,
                startDate: true,
                endDate: true,
                duration: true,
                fullPrice: true,
                grant: true,
                actualPrice: true,
                ...(supportsAreaId ? { area: { select: { bankAccountInfo: { select: { bankName: true, accNum: true } } } } } : {}),
                ...(supportsCreatedAt ? { createdAt: true } : {}),
            },
        }) as ClientTriggerSource[];

        for (const client of clients) {
            const job = this.buildClientJob(rule, client);
            await this.persistPendingJob(job, rule, includePast);
        }
    }

    private async persistPendingJob(
        job: MessageTriggerJobEntity | null,
        rule: MessageTriggerRuleEntity,
        includePast: boolean,
    ): Promise<void> {
        if (!job) return;
        // IMMEDIATE jobs must fire only on the live create/assign path (includePast=true).
        // Delayed lifecycle jobs that are already overdue should still be persisted so the
        // due-job scheduler can send missed automations in scheduledFor order.
        if (
            !includePast &&
            rule.offsetType === MessageTriggerOffsetType.IMMEDIATE &&
            job.scheduledFor.getTime() <= Date.now()
        ) {
            return;
        }
        await this.jobRepository.upsertPending(job);
    }

    private buildClientJob(
        rule: MessageTriggerRuleEntity,
        client: ClientTriggerSource,
    ): MessageTriggerJobEntity | null {
        if (!client.phone) return null;

        const anchorDate = this.getClientAnchorDate(rule.eventType, client);
        if (!anchorDate) return null;

        const scheduledFor = this.computeScheduledFor(anchorDate, rule);
        const payload = {
            clientId: client.id,
            clientName: client.name,
            memberId: client.id.toString(),
            recipientName: client.name,
            recipientPhone: client.phone,
            templateVariables: this.buildClientTemplateVariables(rule, client),
        };

        return MessageTriggerJobEntity.create({
            branchId: rule.branchId ?? undefined,
            ruleId: rule.id,
            scheduledFor,
            clientId: client.id,
            recipientType: rule.recipientType,
            recipientPhone: client.phone,
            templateKey: rule.templateKey,
            dedupeKey: this.buildDedupeKey(rule.id, `client:${client.id}`, scheduledFor, rule.recipientType),
            payload,
        });
    }

    private buildEmployeeAssignmentJob(
        rule: MessageTriggerRuleEntity,
        schedule: {
            id: number;
            clientId: number;
            startDate: Date;
            primaryEmployeeId: number;
            secondaryEmployeeId: number | null;
            client: { id: number; name: string };
            primaryEmployee: { id: number; name: string; phone: string } | null;
            secondaryEmployee: { id: number; name: string; phone: string } | null;
        },
    ): MessageTriggerJobEntity | null {
        const employee =
            rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
                ? schedule.primaryEmployee
                : schedule.secondaryEmployee;
        if (!employee?.phone) return null;

        const scheduledFor = new Date();
        const memberId = `employee:${employee.id}`;
        return MessageTriggerJobEntity.create({
            branchId: rule.branchId ?? undefined,
            ruleId: rule.id,
            scheduledFor,
            clientId: schedule.clientId,
            employeeScheduleId: schedule.id,
            recipientType: rule.recipientType,
            recipientPhone: employee.phone,
            templateKey: rule.templateKey,
            dedupeKey: this.buildDedupeKey(
                rule.id,
                `schedule:${schedule.id}:${rule.recipientType}`,
                scheduledFor,
                rule.recipientType,
            ),
            payload: {
                clientId: schedule.clientId,
                clientName: schedule.client.name,
                employeeId: employee.id,
                employeeName: employee.name,
                memberId,
                recipientName: employee.name,
                recipientPhone: employee.phone,
                templateVariables: {
                    employeeName: employee.name,
                    clientName: schedule.client.name,
                    serviceStartDate: this.formatDate(schedule.startDate),
                },
            },
        });
    }

    private buildClientTemplateVariables(
        rule: MessageTriggerRuleEntity,
        client: ClientTriggerSource,
    ): Record<string, string> {
        switch (rule.templateKey) {
            case MessageTriggerTemplateKey.CLIENT_WELCOME:
                return {
                    clientName: client.name,
                    registrationDate: this.formatDate(client.createdAt ?? null),
                    serviceType: client.type ?? "방문요양",
                };
            case MessageTriggerTemplateKey.SERVICE_START_REMINDER:
                return {
                    clientName: client.name,
                    serviceStartDate: this.formatDate(client.startDate),
                    timingText: this.describeTiming(rule, "서비스 시작"),
                };
            case MessageTriggerTemplateKey.SERVICE_END_REMINDER:
                return {
                    clientName: client.name,
                    serviceEndDate: this.formatDate(client.endDate),
                    timingText: this.describeTiming(rule, "서비스 종료"),
                };
            case MessageTriggerTemplateKey.PRICE_INFO:
                // PRICE_INFO is the only SMS template that renders price/bank fields,
                // so it is the only one that carries them into the job payload (data minimization).
                return buildSmsClientVariables(client);
            case MessageTriggerTemplateKey.SERVICE_INFO:
            case MessageTriggerTemplateKey.CLIENT_GREETING:
            case MessageTriggerTemplateKey.REMINDER:
            case MessageTriggerTemplateKey.THANKS:
            case MessageTriggerTemplateKey.SURVEY:
            case MessageTriggerTemplateKey.INFO:
                return { name: client.name, clientName: client.name, phone: client.phone ?? "" };
            default:
                return {};
        }
    }

    private getClientAnchorDate(
        eventType: MessageTriggerEventType,
        client: Pick<ClientTriggerSource, "createdAt" | "startDate" | "endDate">,
    ): Date | null {
        switch (eventType) {
            case MessageTriggerEventType.CLIENT_CREATED:
                return client.createdAt ?? null;
            case MessageTriggerEventType.SERVICE_START:
                return client.startDate;
            case MessageTriggerEventType.SERVICE_END:
                return client.endDate;
            default:
                return null;
        }
    }

    private computeScheduledFor(anchorDate: Date, rule: MessageTriggerRuleEntity): Date {
        if (rule.offsetType === MessageTriggerOffsetType.IMMEDIATE) {
            return new Date();
        }

        const targetDate = new Date(anchorDate);
        targetDate.setHours(9, 0, 0, 0);

        if (rule.offsetType === MessageTriggerOffsetType.BEFORE_DAYS) {
            targetDate.setDate(targetDate.getDate() - rule.offsetDays);
        } else if (rule.offsetType === MessageTriggerOffsetType.AFTER_DAYS) {
            targetDate.setDate(targetDate.getDate() + rule.offsetDays);
        }

        return targetDate;
    }

    private buildDedupeKey(
        ruleId: string,
        sourceKey: string,
        scheduledFor: Date,
        recipientType: MessageTriggerRecipientType,
    ): string {
        return `${ruleId}:${sourceKey}:${recipientType}:${scheduledFor.toISOString()}`;
    }

    private describeTiming(rule: MessageTriggerRuleEntity, anchorLabel: string): string {
        switch (rule.offsetType) {
            case MessageTriggerOffsetType.SAME_DAY:
                return `${anchorLabel} 당일 안내`;
            case MessageTriggerOffsetType.BEFORE_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 전 안내`;
            case MessageTriggerOffsetType.AFTER_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 후 안내`;
            case MessageTriggerOffsetType.IMMEDIATE:
                return "즉시 안내";
            default:
                return "알림 안내";
        }
    }

    private formatDate(date: Date | null): string {
        if (!date) return "";
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    private normalizeOffsetDays(
        offsetType: MessageTriggerOffsetType,
        offsetDays?: number,
    ): number {
        if (
            offsetType === MessageTriggerOffsetType.IMMEDIATE ||
            offsetType === MessageTriggerOffsetType.SAME_DAY
        ) {
            return 0;
        }
        return offsetDays ?? 0;
    }

    private validateRule(params: UpsertRuleParams): void {
        if (!EVENT_RECIPIENT_OPTIONS[params.eventType].includes(params.recipientType)) {
            throw new BadRequestException("Invalid recipient for selected event type");
        }

        if (!EVENT_OFFSET_OPTIONS[params.eventType].includes(params.offsetType)) {
            throw new BadRequestException("Invalid offset type for selected event type");
        }

        const normalizedOffsetDays = this.normalizeOffsetDays(params.offsetType, params.offsetDays);
        if (
            (params.offsetType === MessageTriggerOffsetType.BEFORE_DAYS ||
                params.offsetType === MessageTriggerOffsetType.AFTER_DAYS) &&
            normalizedOffsetDays <= 0
        ) {
            throw new BadRequestException("Offset days must be greater than 0");
        }

        if (
            !isCompatibleMessageTriggerTemplate({
                templateKey: params.templateKey,
                eventType: params.eventType,
                recipientType: params.recipientType,
            })
        ) {
            throw new BadRequestException("Template is not compatible with the selected event and recipient");
        }

        if (!MESSAGE_TRIGGER_TEMPLATE_CATALOG[params.templateKey]) {
            throw new BadRequestException("Unknown template key");
        }
    }

    private async cancelPendingJobsForRule(ruleId: string, reason: string): Promise<void> {
        const jobs = await this.jobRepository.findPendingByRuleId(ruleId);
        for (const job of jobs) {
            job.cancel(reason);
            await this.jobRepository.update(job);
        }
    }

    private async cancelPendingJobsForClient(
        ruleIds: string[],
        clientId: number,
        reason: string,
    ): Promise<void> {
        const jobs = await this.jobRepository.findPendingByRuleIdsAndClientId(ruleIds, clientId);
        for (const job of jobs) {
            job.cancel(reason);
            await this.jobRepository.update(job);
        }
    }

    private async cancelPendingJobsForEmployeeSchedule(
        ruleIds: string[],
        employeeScheduleId: number,
        reason: string,
    ): Promise<void> {
        const jobs = await this.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId(
            ruleIds,
            employeeScheduleId,
        );
        for (const job of jobs) {
            job.cancel(reason);
            await this.jobRepository.update(job);
        }
    }

    private async hasTriggerSchema(): Promise<boolean> {
        const [hasRuleTable, hasJobTable] = await Promise.all([
            hasTable(this.prisma, "message_trigger_rule"),
            hasTable(this.prisma, "message_trigger_job"),
        ]);
        return hasRuleTable && hasJobTable;
    }

    private async ensureTriggerSchemaReady(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            throw new ServiceUnavailableException(
                "Message trigger tables are not available. Apply the database migration first.",
            );
        }
    }
}
