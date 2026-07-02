import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    ALIMTALK_TRIGGER_TEMPLATE_CATALOG,
    EVENT_OFFSET_OPTIONS,
    EVENT_RECIPIENT_OPTIONS,
    getAlimtalkTriggerTemplateCatalog,
    isCompatibleTriggerTemplate,
    type SupportedTriggerProvider,
    AlimtalkTriggerEventType,
    AlimtalkTriggerOffsetType,
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerRuleEntity } from "domain/entities/alimtalk-trigger-rule.entity";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import {
    ALIMTALK_TRIGGER_RULE_REPOSITORY,
    IAlimtalkTriggerRuleRepository,
} from "domain/repositories/alimtalk-trigger-rule.repository.interface";
import {
    ALIMTALK_TRIGGER_JOB_REPOSITORY,
    IAlimtalkTriggerJobRepository,
} from "domain/repositories/alimtalk-trigger-job.repository.interface";
import {
    ALIMTALK_LOG_REPOSITORY,
    IAlimtalkLogRepository,
} from "domain/repositories/alimtalk-log.repository.interface";
import { MessageTriggerDeliveryService } from "./message-trigger-delivery.service";
import { hasColumn, hasTable } from "infrastructure/database/schema-capabilities";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import { buildSmsClientVariables } from "./sms-client-variables";

interface UpsertRuleParams {
    name: string;
    isActive?: boolean;
    eventType: AlimtalkTriggerEventType;
    offsetType: AlimtalkTriggerOffsetType;
    offsetDays?: number;
    recipientType: AlimtalkTriggerRecipientType;
    templateKey: AlimtalkTriggerTemplateKey;
}

const DEFAULT_SERVICE_INFO_TRIGGER: UpsertRuleParams = {
    name: "서비스 시작 7일 전 서비스 안내",
    isActive: true,
    eventType: AlimtalkTriggerEventType.SERVICE_START,
    offsetType: AlimtalkTriggerOffsetType.BEFORE_DAYS,
    offsetDays: 7,
    recipientType: AlimtalkTriggerRecipientType.CLIENT,
    templateKey: AlimtalkTriggerTemplateKey.SERVICE_INFO,
};

const DEFAULT_CLIENT_GREETING_TRIGGER: UpsertRuleParams = {
    name: "신규 고객 인사 메시지",
    isActive: true,
    eventType: AlimtalkTriggerEventType.CLIENT_CREATED,
    offsetType: AlimtalkTriggerOffsetType.IMMEDIATE,
    offsetDays: 0,
    recipientType: AlimtalkTriggerRecipientType.CLIENT,
    templateKey: AlimtalkTriggerTemplateKey.CLIENT_GREETING,
};

export interface UpcomingAlimtalkTriggerJobView {
    id: string;
    ruleId: string;
    ruleName: string;
    eventType: AlimtalkTriggerEventType | null;
    offsetType: AlimtalkTriggerOffsetType | null;
    offsetDays: number;
    recipientType: AlimtalkTriggerRecipientType;
    recipientPhone: string | null;
    templateKey: AlimtalkTriggerTemplateKey;
    status: string;
    scheduledFor: Date;
    sentAt: Date | null;
    canceledAt: Date | null;
    cancelReason: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
    payload: AlimtalkTriggerJobEntity["payload"];
    createdAt: Date;
    updatedAt: Date;
}

export interface AlimtalkHistoryRecordView {
    id: number;
    provider: string;
    templateKey: string;
    triggerJobId: string | null;
    receiver: string;
    clientId: number | null;
    messageBody: string;
    variables: Record<string, string>;
    status: AlimtalkLogEntity["status"];
    aligoMid: string | null;
    errorMessage: string | null;
    attempts: number;
    lastAttemptAt: Date | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    ruleId: string | null;
    ruleName: string | null;
    eventType: AlimtalkTriggerEventType | null;
    offsetType: AlimtalkTriggerOffsetType | null;
    offsetDays: number;
    scheduledFor: Date | null;
    recipientType: AlimtalkTriggerRecipientType | null;
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
export class AlimtalkTriggerService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly deliveryService: MessageTriggerDeliveryService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Inject(ALIMTALK_TRIGGER_RULE_REPOSITORY)
        private readonly ruleRepository: IAlimtalkTriggerRuleRepository,
        @Inject(ALIMTALK_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository: IAlimtalkTriggerJobRepository,
        @Inject(ALIMTALK_LOG_REPOSITORY)
        private readonly logRepository: IAlimtalkLogRepository,
    ) {}

    async listRules(branchId: string): Promise<AlimtalkTriggerRuleEntity[]> {
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
    ): Promise<UpcomingAlimtalkTriggerJobView[]> {
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
    ): Promise<AlimtalkHistoryRecordView[]> {
        if (!(await hasTable(this.prisma, "alimtalk_log"))) {
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
            ? await this.prisma.alimtalk_trigger_job.findMany({
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
            const payload = (job?.payload as AlimtalkTriggerJobEntity["payload"] | undefined) ?? null;
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
                recipientType: (job?.recipientType as AlimtalkTriggerRecipientType | undefined) ?? null,
                recipientName: payload?.recipientName ?? null,
                clientName: payload?.clientName ?? null,
                employeeName: payload?.employeeName ?? null,
            };
        });
    }

    async getRule(branchId: string, id: string): Promise<AlimtalkTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        const rule = await this.ruleRepository.findById(branchId, id);
        if (!rule) {
            throw new NotFoundException(`Trigger rule ${id} not found`);
        }
        return rule;
    }

    listTemplates(params: {
        provider: SupportedTriggerProvider;
        eventType?: AlimtalkTriggerEventType;
        recipientType?: AlimtalkTriggerRecipientType;
    }) {
        return getAlimtalkTriggerTemplateCatalog(params.provider).filter((item) => {
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
    ): Promise<AlimtalkTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        this.validateRule(params);
        const rule = await this.ruleRepository.create(
            branchId,
            AlimtalkTriggerRuleEntity.create({
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
    ): Promise<AlimtalkTriggerRuleEntity> {
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
            AlimtalkTriggerEventType.CLIENT_CREATED,
            AlimtalkTriggerEventType.SERVICE_START,
            AlimtalkTriggerEventType.SERVICE_END,
        ]);

        await this.cancelPendingJobsForClient(rules.map((rule) => rule.id), clientId, "Client data changed");

        for (const rule of rules) {
            if (rule.eventType === AlimtalkTriggerEventType.CLIENT_CREATED && !supportsCreatedAt) {
                continue;
            }
            if (rule.templateKey === AlimtalkTriggerTemplateKey.CLIENT_GREETING && suppressGreeting) {
                continue;
            }
            const job = this.buildClientJob(rule, client);
            await this.persistPendingJob(job, includePast);
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
            AlimtalkTriggerEventType.EMPLOYEE_ASSIGNED,
        ]);

        await this.cancelPendingJobsForEmployeeSchedule(
            rules.map((rule) => rule.id),
            employeeScheduleId,
            "Employee assignment changed",
        );

        for (const rule of rules) {
            const job = this.buildEmployeeAssignmentJob(rule, schedule);
            await this.persistPendingJob(job, includePast);
        }
    }

    async hasActiveRulesForEvents(
        branchId: string,
        eventTypes: AlimtalkTriggerEventType[],
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, eventTypes);
        return rules.length > 0;
    }

    private async ensureDefaultTrigger(
        branchId: string,
        rules: AlimtalkTriggerRuleEntity[],
        defaults: UpsertRuleParams,
        matchTemplateKeyOnly = false,
    ): Promise<{ rules: AlimtalkTriggerRuleEntity[]; created: AlimtalkTriggerRuleEntity | null }> {
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
            AlimtalkTriggerRuleEntity.create({
                branchId,
                ...defaults,
            }),
        );
        await this.rebuildJobsForRule(branchId, created, false);
        return { rules: [created, ...rules], created };
    }

    private async ensureDefaultServiceInfoTrigger(
        branchId: string,
        rules: AlimtalkTriggerRuleEntity[],
    ): Promise<AlimtalkTriggerRuleEntity[]> {
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
        rule: AlimtalkTriggerRuleEntity,
        includePast: boolean,
    ): Promise<void> {
        if (!rule.isActive) return;

        if (rule.eventType === AlimtalkTriggerEventType.EMPLOYEE_ASSIGNED) {
            return;
        }

        if (rule.offsetType === AlimtalkTriggerOffsetType.IMMEDIATE) return;

        const supportsCreatedAt = await hasColumn(this.prisma, "client", "created_at");
        if (rule.eventType === AlimtalkTriggerEventType.CLIENT_CREATED && !supportsCreatedAt) {
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
            await this.persistPendingJob(job, includePast);
        }
    }

    private async persistPendingJob(
        job: AlimtalkTriggerJobEntity | null,
        includePast: boolean,
    ): Promise<void> {
        if (!job) return;
        // IMMEDIATE / now-scheduled jobs must fire ONLY on the live create/assign path
        // (includePast=true). On any re-sync path (includePast=false: client update,
        // due-date scheduler, rule rebuild) a "now" job is a re-fire and must be dropped.
        // Note the `<=`: a job scheduledFor === Date.now() is a re-fire on these paths and
        // is dropped, preventing repeat greetings on every edit/scheduler pass. The
        // create-time greeting is preserved because that path uses includePast=true.
        if (!includePast && job.scheduledFor.getTime() <= Date.now()) return;
        await this.jobRepository.upsertPending(job);
    }

    private buildClientJob(
        rule: AlimtalkTriggerRuleEntity,
        client: ClientTriggerSource,
    ): AlimtalkTriggerJobEntity | null {
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

        return AlimtalkTriggerJobEntity.create({
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
        rule: AlimtalkTriggerRuleEntity,
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
    ): AlimtalkTriggerJobEntity | null {
        const employee =
            rule.recipientType === AlimtalkTriggerRecipientType.PRIMARY_EMPLOYEE
                ? schedule.primaryEmployee
                : schedule.secondaryEmployee;
        if (!employee?.phone) return null;

        const scheduledFor = new Date();
        const memberId = `employee:${employee.id}`;
        return AlimtalkTriggerJobEntity.create({
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
        rule: AlimtalkTriggerRuleEntity,
        client: ClientTriggerSource,
    ): Record<string, string> {
        switch (rule.templateKey) {
            case AlimtalkTriggerTemplateKey.CLIENT_WELCOME:
                return {
                    clientName: client.name,
                    registrationDate: this.formatDate(client.createdAt ?? null),
                    serviceType: client.type ?? "방문요양",
                };
            case AlimtalkTriggerTemplateKey.SERVICE_START_REMINDER:
                return {
                    clientName: client.name,
                    serviceStartDate: this.formatDate(client.startDate),
                    timingText: this.describeTiming(rule, "서비스 시작"),
                };
            case AlimtalkTriggerTemplateKey.SERVICE_END_REMINDER:
                return {
                    clientName: client.name,
                    serviceEndDate: this.formatDate(client.endDate),
                    timingText: this.describeTiming(rule, "서비스 종료"),
                };
            case AlimtalkTriggerTemplateKey.PRICE_INFO:
                // PRICE_INFO is the only SMS template that renders price/bank fields,
                // so it is the only one that carries them into the job payload (data minimization).
                return buildSmsClientVariables(client);
            case AlimtalkTriggerTemplateKey.SERVICE_INFO:
            case AlimtalkTriggerTemplateKey.CLIENT_GREETING:
            case AlimtalkTriggerTemplateKey.REMINDER:
            case AlimtalkTriggerTemplateKey.THANKS:
            case AlimtalkTriggerTemplateKey.SURVEY:
            case AlimtalkTriggerTemplateKey.INFO:
                return { name: client.name, clientName: client.name, phone: client.phone ?? "" };
            default:
                return {};
        }
    }

    private getClientAnchorDate(
        eventType: AlimtalkTriggerEventType,
        client: Pick<ClientTriggerSource, "createdAt" | "startDate" | "endDate">,
    ): Date | null {
        switch (eventType) {
            case AlimtalkTriggerEventType.CLIENT_CREATED:
                return client.createdAt ?? null;
            case AlimtalkTriggerEventType.SERVICE_START:
                return client.startDate;
            case AlimtalkTriggerEventType.SERVICE_END:
                return client.endDate;
            default:
                return null;
        }
    }

    private computeScheduledFor(anchorDate: Date, rule: AlimtalkTriggerRuleEntity): Date {
        if (rule.offsetType === AlimtalkTriggerOffsetType.IMMEDIATE) {
            return new Date();
        }

        const targetDate = new Date(anchorDate);
        targetDate.setHours(9, 0, 0, 0);

        if (rule.offsetType === AlimtalkTriggerOffsetType.BEFORE_DAYS) {
            targetDate.setDate(targetDate.getDate() - rule.offsetDays);
        } else if (rule.offsetType === AlimtalkTriggerOffsetType.AFTER_DAYS) {
            targetDate.setDate(targetDate.getDate() + rule.offsetDays);
        }

        return targetDate;
    }

    private buildDedupeKey(
        ruleId: string,
        sourceKey: string,
        scheduledFor: Date,
        recipientType: AlimtalkTriggerRecipientType,
    ): string {
        return `${ruleId}:${sourceKey}:${recipientType}:${scheduledFor.toISOString()}`;
    }

    private describeTiming(rule: AlimtalkTriggerRuleEntity, anchorLabel: string): string {
        switch (rule.offsetType) {
            case AlimtalkTriggerOffsetType.SAME_DAY:
                return `${anchorLabel} 당일 안내`;
            case AlimtalkTriggerOffsetType.BEFORE_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 전 안내`;
            case AlimtalkTriggerOffsetType.AFTER_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 후 안내`;
            case AlimtalkTriggerOffsetType.IMMEDIATE:
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
        offsetType: AlimtalkTriggerOffsetType,
        offsetDays?: number,
    ): number {
        if (
            offsetType === AlimtalkTriggerOffsetType.IMMEDIATE ||
            offsetType === AlimtalkTriggerOffsetType.SAME_DAY
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
            (params.offsetType === AlimtalkTriggerOffsetType.BEFORE_DAYS ||
                params.offsetType === AlimtalkTriggerOffsetType.AFTER_DAYS) &&
            normalizedOffsetDays <= 0
        ) {
            throw new BadRequestException("Offset days must be greater than 0");
        }

        if (
            !isCompatibleTriggerTemplate({
                templateKey: params.templateKey,
                eventType: params.eventType,
                recipientType: params.recipientType,
            })
        ) {
            throw new BadRequestException("Template is not compatible with the selected event and recipient");
        }

        if (!ALIMTALK_TRIGGER_TEMPLATE_CATALOG[params.templateKey]) {
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
            hasTable(this.prisma, "alimtalk_trigger_rule"),
            hasTable(this.prisma, "alimtalk_trigger_job"),
        ]);
        return hasRuleTable && hasJobTable;
    }

    private async ensureTriggerSchemaReady(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            throw new ServiceUnavailableException(
                "AlimTalk trigger tables are not available. Apply the database migration first.",
            );
        }
    }
}
