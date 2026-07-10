import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { message_log, message_trigger_job, Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SERVICE_FEEDBACK_LINK_RULE_ID,
    SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-feedback-link-message";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { EmployeeFeedbackLinkService } from "./employee-feedback-link.service";
import {
    AdminServiceRecordAssignmentDto,
    AdminServiceRecordHeaderDto,
    AdminServiceRecordLinkDto,
    AdminServiceRecordLinkStatus,
    AdminServiceRecordOverviewDto,
    AdminServiceRecordSessionDto,
    AdminServiceRecordSignatureDocDto,
    AdminServiceRecordTokenDto,
    AdminServiceRecordTokenState,
} from "interface/dto/admin-service-record.dto";

type ScheduleForOverview = Prisma.employee_scheduleGetPayload<{
    include: {
        client: true;
        primaryEmployee: true;
        serviceRecord: true;
        serviceRecordDays: true;
        feedbackTokens: true;
    };
}>;

type FeedbackLinkJob = message_trigger_job;
type FeedbackLinkLog = message_log;
type SignatureDocRow = Prisma.eformsign_docGetPayload<{
    select: {
        employeeScheduleId: true;
        documentId: true;
        statusDetail: true;
        stepName: true;
        createdDate: true;
        updatedDate: true;
    };
}>;

@Injectable()
export class AdminServiceRecordService {
    private readonly logger = new Logger(AdminServiceRecordService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly employeeFeedbackLinkService: EmployeeFeedbackLinkService,
    ) {}

    async getClientOverview(branchId: string, clientId: number): Promise<AdminServiceRecordOverviewDto> {
        const schedules = await this.prisma.employee_schedule.findMany({
            where: { branchId, clientId },
            include: {
                client: true,
                primaryEmployee: true,
                serviceRecord: true,
                serviceRecordDays: { orderBy: { sessionIndex: "asc" } },
                feedbackTokens: { orderBy: { createdAt: "desc" } },
            },
            orderBy: { startDate: "desc" },
        });

        if (schedules.length === 0) {
            return { assignments: [] };
        }

        const scheduleIds = schedules.map((schedule) => schedule.id);
        const jobs = await this.prisma.message_trigger_job.findMany({
            where: {
                branchId,
                employeeScheduleId: { in: scheduleIds },
                ruleId: SERVICE_FEEDBACK_LINK_RULE_ID,
            },
            orderBy: { createdAt: "desc" },
        });
        const jobIds = jobs.map((job) => job.id);
        const logs = await this.prisma.message_log.findMany({
            where: {
                branchId,
                templateKey: SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
                OR: [
                    ...(jobIds.length > 0 ? [{ triggerJobId: { in: jobIds } }] : []),
                    { clientId, triggerJobId: null },
                ],
            },
            orderBy: { createdAt: "desc" },
        });
        const signatureDocs = await this.findServiceFeedbackSignatureDocs(branchId, scheduleIds);
        const signatureDocByScheduleId = latestSignatureDocByScheduleId(signatureDocs);

        return {
            assignments: schedules.map((schedule) => this.mapAssignment(
                schedule,
                jobs.filter((job) => job.employeeScheduleId === schedule.id),
                logs.filter((log) => (
                    (log.triggerJobId !== null && jobIdsForSchedule(jobs, schedule.id).has(log.triggerJobId))
                    || (log.triggerJobId === null && logScheduleId(log) === schedule.id)
                )),
                signatureDocByScheduleId.get(schedule.id) ?? null,
            )),
        };
    }

    async sendLinkNow(branchId: string, scheduleId: number): Promise<{ scheduledFor: Date }> {
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: scheduleId, branchId },
            select: { id: true },
        });
        if (!schedule) {
            throw new NotFoundException("Assignment not found");
        }

        return this.employeeFeedbackLinkService.sendNow(scheduleId);
    }

    private mapAssignment(
        schedule: ScheduleForOverview,
        jobs: FeedbackLinkJob[],
        logs: FeedbackLinkLog[],
        signatureDoc: AdminServiceRecordSignatureDocDto | null,
    ): AdminServiceRecordAssignmentDto {
        return {
            scheduleId: schedule.id,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            replaced: schedule.replaced,
            employee: {
                id: schedule.primaryEmployee.id,
                name: schedule.primaryEmployee.name,
                phone: schedule.primaryEmployee.phone,
            },
            link: this.deriveLink(jobs, logs, schedule.feedbackTokens[0] ?? null),
            header: schedule.serviceRecord ? this.mapHeader(schedule.serviceRecord) : null,
            totalSessions: schedule.client.duration ?? 0,
            sessions: schedule.serviceRecordDays.map((session) => this.mapSession(session)),
            signatureDoc,
        };
    }

    private deriveLink(
        jobs: FeedbackLinkJob[],
        logs: FeedbackLinkLog[],
        token: ScheduleForOverview["feedbackTokens"][number] | null,
    ): AdminServiceRecordLinkDto {
        const sentLogs = logs
            .filter((log) => log.status === "sent")
            .sort((left, right) => this.logActivityTime(right) - this.logActivityTime(left));
        const pendingJob = jobs.find((job) => job.status === "pending") ?? null;
        const newestLog = logs[0] ?? null;
        const newestJob = jobs[0] ?? null;
        const sentCount = sentLogs.length;
        let status: AdminServiceRecordLinkStatus = "none";
        let scheduledFor: Date | null = null;

        if (sentCount > 0) {
            status = "sent";
        } else if (pendingJob) {
            status = "scheduled";
            scheduledFor = pendingJob.scheduledFor;
        } else if (newestLog?.status === "failed") {
            status = "failed";
        } else if (newestJob?.status === "canceled") {
            status = "canceled";
        }

        return {
            status,
            scheduledFor,
            sentCount,
            lastSentAt: sentLogs[0]?.lastAttemptAt ?? sentLogs[0]?.createdAt ?? null,
            token: token ? this.mapToken(token) : null,
        };
    }

    private mapToken(token: ScheduleForOverview["feedbackTokens"][number]): AdminServiceRecordTokenDto {
        return {
            issuedAt: token.createdAt,
            verifiedAt: token.verifiedAt,
            expiresAt: token.expiresAt,
            state: this.getTokenState(token),
        };
    }

    private getTokenState(token: ScheduleForOverview["feedbackTokens"][number]): AdminServiceRecordTokenState {
        if (token.revokedAt) return "revoked";
        if (token.expiresAt.getTime() < Date.now()) return "expired";
        if (token.active) return "active";
        return "revoked";
    }

    private mapHeader(header: ScheduleForOverview["serviceRecord"]): AdminServiceRecordHeaderDto {
        return {
            momName: header?.momName ?? null,
            momBirth: header?.momBirth ?? null,
            babyName: header?.babyName ?? null,
            babyBirth: header?.babyBirth ?? null,
            deliveryType: header?.deliveryType ?? null,
            babyWeight: header?.babyWeight ?? null,
            createdAt: header?.createdAt ?? new Date(0),
            updatedAt: header?.updatedAt ?? new Date(0),
        };
    }

    private mapSession(session: ScheduleForOverview["serviceRecordDays"][number]): AdminServiceRecordSessionDto {
        return {
            sessionIndex: session.sessionIndex,
            serviceDate: session.serviceDate,
            locked: session.locked,
            submittedAt: session.submittedAt,
            updatedAt: session.updatedAt,
            answers: session.answers,
            etcService: session.etcService,
            notes: session.notes,
            paymentConfirmed: session.paymentConfirmed,
            hasMomSignature: Boolean(session.momSignature),
        };
    }

    private logActivityTime(log: FeedbackLinkLog): number {
        return (log.lastAttemptAt ?? log.createdAt).getTime();
    }

    private async findServiceFeedbackSignatureDocs(
        branchId: string,
        scheduleIds: number[],
    ): Promise<SignatureDocRow[]> {
        try {
            return await this.prisma.eformsign_doc.findMany({
                where: {
                    branchId,
                    employeeScheduleId: { in: scheduleIds },
                    documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_FEEDBACK_SNAPSHOT,
                },
                select: {
                    employeeScheduleId: true,
                    documentId: true,
                    statusDetail: true,
                    stepName: true,
                    createdDate: true,
                    updatedDate: true,
                },
                orderBy: [
                    { employeeScheduleId: "asc" },
                    { updatedDate: "desc" },
                    { createdDate: "desc" },
                ],
            });
        } catch (error) {
            if (!isPendingEformsignFeedbackColumnError(error)) {
                throw error;
            }

            this.logger.warn(
                "Skipping service feedback signature docs because eformsign_doc feedback columns are not migrated yet.",
            );
            return [];
        }
    }
}

function isPendingEformsignFeedbackColumnError(error: unknown): boolean {
    const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "P2022") {
        return true;
    }

    const column = typeof error === "object" && error !== null && "meta" in error
        ? (error as { meta?: { column?: unknown } }).meta?.column
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const haystack = `${message} ${typeof column === "string" ? column : ""}`;
    return /document_kind|employee_schedule_id|template_id|documentKind|employeeScheduleId|templateId/i.test(haystack);
}

function jobIdsForSchedule(jobs: FeedbackLinkJob[], scheduleId: number): Set<string> {
    return new Set(
        jobs
            .filter((job) => job.employeeScheduleId === scheduleId)
            .map((job) => job.id),
    );
}

/** Permanent-failure logs carry no trigger job; their scheduleId lives only in the variables payload. */
function logScheduleId(log: FeedbackLinkLog): number | null {
    const variables = log.variables;
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) return null;
    const raw = (variables as Record<string, unknown>)["scheduleId"];
    const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : Number.NaN;
    return Number.isNaN(parsed) ? null : parsed;
}

function latestSignatureDocByScheduleId(docs: SignatureDocRow[]): Map<number, AdminServiceRecordSignatureDocDto> {
    const byScheduleId = new Map<number, AdminServiceRecordSignatureDocDto>();
    for (const doc of docs) {
        if (doc.employeeScheduleId === null || byScheduleId.has(doc.employeeScheduleId)) continue;
        byScheduleId.set(doc.employeeScheduleId, {
            documentId: doc.documentId,
            statusDetail: doc.statusDetail,
            stepName: doc.stepName,
            createdDate: doc.createdDate,
            updatedDate: doc.updatedDate,
        });
    }
    return byScheduleId;
}
