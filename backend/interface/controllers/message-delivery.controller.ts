import {
    BadGatewayException,
    BadRequestException,
    Body,
    Controller,
    ConflictException,
    Headers,
    Logger,
    NotFoundException,
    Post,
    ServiceUnavailableException,
    UseGuards,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { AligoService } from "application/services/aligo.service";
import { SendSmsMessageDto } from "interface/dto/message-delivery.dto";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { parseKstSchedule } from "application/utils/kst-schedule";
import { normalizePhone } from "application/utils/normalize-phone";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SMS_MANUAL_PROVIDER_REJECTED_RETRY_SAFETY,
    SMS_PARTIAL_RETRY_SAFETY,
} from "domain/entities/message-log.entity";
import {
    buildSmsProviderAcceptanceFingerprint,
    buildSmsProviderAcceptanceKey,
} from "application/services/sms-provider-acceptance.service";
import {
    classifySmsProviderOutcome,
} from "application/services/sms-provider-outcome.service";
import type {
    ProblemCode,
    ProblemDetails,
    ProblemOutcome,
} from "@babyjamjam/shared/errors/problem-details";

const ALIGO_SCHEDULE_MIN_LEAD_MS = 10 * 60 * 1000;

interface SmsMessageLogRecord {
    id: number;
    providerAcceptanceKey?: string | null;
    providerAcceptanceFingerprint?: string | null;
    providerAcceptanceState?: string | null;
    providerCallStartedAt?: Date | null;
    status?: string | null;
    variables?: Prisma.JsonValue | null;
}

type SmsProblemCode = Extract<
    ProblemCode,
    | "MESSAGE_SEND_NOT_STARTED"
    | "MESSAGE_SEND_UNCONFIRMED"
    | "MESSAGE_SEND_PARTIAL"
    | "MESSAGE_SEND_REJECTED"
    | "MESSAGE_SEND_ALREADY_REQUESTED"
    | "MESSAGE_REQUEST_KEY_CONFLICT"
    | "REQUEST_INVALID"
    | "RESOURCE_NOT_FOUND"
>;

type SmsProblemBody = Pick<
    ProblemDetails,
    "code" | "params" | "outcome" | "recovery" | "operationId"
>;

@Controller("message-deliveries")
@UseGuards(JwtGuard, TenantGuard, OwnerOrAdminGuard)
export class MessageDeliveryController {
    private readonly logger = new Logger(MessageDeliveryController.name);

    constructor(
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        private readonly prisma: PrismaService,
    ) {}

    @Post("sms")
    async sendSms(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: SendSmsMessageDto,
        @Headers("idempotency-key") requestId?: string,
    ) {
        const triggerType = dto.triggerType ?? "immediate";
        const branchId = tenant.branchId ?? "";
        const resolvedDto = await this.resolveSmsRecipients(branchId, dto);
        this.logger.log(
            `[SMS] Request received: branchId=${branchId || "unknown"}, triggerType=${triggerType}, recipientCount=${this.countSmsRecipients(resolvedDto.receiver)}`,
        );

        try {
            await this.messageSenderApprovalService.ensureApproved(branchId);
        } catch (error) {
            this.logger.warn(
                `[SMS] Sender approval check failed: branchId=${branchId || "unknown"}, error=${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
        }

        if (triggerType === "scheduled") {
            this.assertScheduledAtLeastTenMinutesAhead(
                dto.scheduledDate,
                dto.scheduledTime,
            );
        }

        const scheduledDate = triggerType === "scheduled"
            ? dto.scheduledDate?.replace(/-/g, "")
            : undefined;
        const scheduledTime = triggerType === "scheduled"
            ? dto.scheduledTime?.replace(":", "")
            : undefined;
        const pendingLog = await this.createPendingSmsLog(
            branchId,
            resolvedDto,
            triggerType,
            scheduledDate,
            scheduledTime,
            dto.idempotencyKey ?? requestId,
        ).catch((error) => {
            if (error instanceof ConflictException) {
                throw error;
            }
            this.logger.error(
                `[SMS] Failed to create delivery record before provider request: branchId=${branchId || "unknown"}, error=${this.formatErrorMessage(error)}`,
            );
            throw new ServiceUnavailableException(
                this.smsProblemBody(
                    "MESSAGE_SEND_NOT_STARTED",
                    "NOT_APPLIED",
                ),
                { cause: error },
            );
        });

        if (!pendingLog.created) {
            const state = String(pendingLog.row.providerAcceptanceState ?? "legacy");
            if (state === "accepted" || state === "reconciled_delivered" || pendingLog.row.status === "sent") {
                throw new ConflictException(
                    this.smsProblemBody(
                        "MESSAGE_SEND_ALREADY_REQUESTED",
                        "UNKNOWN",
                        this.safeOperationId(pendingLog.id),
                    ),
                );
            }
            throw new ConflictException(
                this.smsProblemBody(
                    "MESSAGE_SEND_ALREADY_REQUESTED",
                    "UNKNOWN",
                    this.safeOperationId(pendingLog.id),
                ),
            );
        }

        try {
            await this.markProviderCallStarted(pendingLog.row);
        } catch (error) {
            if (error instanceof ConflictException) {
                throw error;
            }
            this.logger.error(
                `[SMS] Failed to persist provider-call boundary: logId=${pendingLog.id}, error=${this.formatErrorMessage(error)}`,
            );
            throw new ServiceUnavailableException(
                this.smsProblemBody(
                    "MESSAGE_SEND_UNCONFIRMED",
                    "UNKNOWN",
                    this.safeOperationId(pendingLog.id),
                ),
                { cause: error },
            );
        }

        const result = await this.aligoService.sendSms({
            receiver: resolvedDto.receiver,
            message: resolvedDto.message,
            recipientName: resolvedDto.recipientName,
            title: resolvedDto.title,
            msgType: resolvedDto.msgType,
            scheduledDate,
            scheduledTime,
            testMode: dto.testMode,
        }).catch(async (error) => {
            const errorMessage = this.formatErrorMessage(error);
            this.logger.warn(
                `[SMS] Aligo request failed: branchId=${branchId || "unknown"}, error=${errorMessage}`,
            );
            await this.updateSmsLog(pendingLog.id, {
                status: "failed",
                errorMessage,
                attempts: 1,
                lastAttemptAt: new Date(),
                nextRetryAt: null,
                providerAcceptanceState: "uncertain",
                providerCallStartedAt: pendingLog.row.providerCallStartedAt ?? new Date(),
                variables: {
                    ...this.smsRecordVariables(pendingLog.row),
                    retrySafety: "uncertain",
                },
            }).catch((logError) => {
                this.logger.error(
                    `[SMS] Provider request failed and delivery record update also failed: logId=${pendingLog.id}, error=${this.formatErrorMessage(logError)}`,
                );
                throw new ServiceUnavailableException(
                    this.smsProblemBody(
                        "MESSAGE_SEND_UNCONFIRMED",
                        "UNKNOWN",
                        this.safeOperationId(pendingLog.id),
                    ),
                    { cause: error },
                );
            });
            throw new BadGatewayException(
                this.smsProblemBody(
                    "MESSAGE_SEND_UNCONFIRMED",
                    "UNKNOWN",
                    this.safeOperationId(pendingLog.id),
                ),
                { cause: error },
            );
        });
        const expectedRecipientCount = this.countSmsRecipients(resolvedDto.receiver);
        const providerOutcome = classifySmsProviderOutcome(result, expectedRecipientCount);
        this.logger.log(
            `[SMS] Aligo response received: branchId=${branchId || "unknown"}, resultCode=${this.smsResultCodeForLog(result)}, errorCount=${this.smsErrorCountForLog(result)}`,
        );
        await this.updateSmsLogFromResult(
            pendingLog.id,
            result,
            triggerType,
            expectedRecipientCount,
            pendingLog.row.variables,
        ).catch((error) => {
            this.logger.error(
                `[SMS] Provider result received but delivery record update failed: logId=${pendingLog.id}, error=${this.formatErrorMessage(error)}`,
            );
            throw new ServiceUnavailableException(
                this.smsProblemBody(
                    "MESSAGE_SEND_UNCONFIRMED",
                    "UNKNOWN",
                    this.safeOperationId(pendingLog.id),
                ),
                { cause: error },
            );
        });

        if (providerOutcome !== "accepted") {
            if (providerOutcome === "partial") {
                throw new BadGatewayException(
                    this.smsProblemBody(
                        "MESSAGE_SEND_PARTIAL",
                        "PARTIALLY_APPLIED",
                        this.safeOperationId(pendingLog.id),
                    ),
                );
            }
            if (providerOutcome === "rejected") {
                throw new BadGatewayException(
                    this.smsProblemBody(
                        "MESSAGE_SEND_REJECTED",
                        "FAILED",
                        this.safeOperationId(pendingLog.id),
                    ),
                );
            }
            throw new BadGatewayException(
                this.smsProblemBody(
                    "MESSAGE_SEND_UNCONFIRMED",
                    "UNKNOWN",
                    this.safeOperationId(pendingLog.id),
                ),
            );
        }

        return {
            provider: "aligo_sms",
            triggerType,
            request: {
                senderPhone: result.request.senderPhone,
                receiver: result.request.receiver,
                msgType: result.request.msgType,
                scheduledAt:
                    result.request.scheduledDate && result.request.scheduledTime
                        ? `${result.request.scheduledDate}${result.request.scheduledTime}`
                        : undefined,
                testMode: result.request.testModeYn === "Y",
            },
            result: {
                resultCode: result.response.result_code,
                message: result.response.message,
                msgId: result.response.msg_id,
                successCount: result.response.success_cnt,
                errorCount: result.response.error_cnt,
                msgType: result.response.msg_type,
            },
        };
    }

    private async createPendingSmsLog(
        branchId: string,
        dto: SendSmsMessageDto,
        triggerType: string,
        scheduledDate?: string,
        scheduledTime?: string,
        requestId?: string,
    ): Promise<{ row: SmsMessageLogRecord; created: boolean; id: number }> {
        // A caller-provided idempotency key (or HTTP Idempotency-Key header)
        // scopes duplicate manual requests. Without one, each intentional
        // send receives a fresh opaque identity; the persisted state still
        // fences crashes before any automatic retry is possible.
        const logicalIdentity = requestId?.trim() || randomUUID();
        const providerAcceptanceKey = buildSmsProviderAcceptanceKey(
            "manual",
            `${branchId}:${logicalIdentity}`,
        );
        const providerAcceptanceFingerprint = buildSmsProviderAcceptanceFingerprint({
            branchId,
            receiver: dto.receiver,
            message: dto.message,
            recipientName: dto.recipientName ?? null,
            title: dto.title?.trim() || null,
            clientId: dto.clientId ?? null,
            employeeId: dto.employeeId ?? null,
            msgType: dto.msgType ?? "AUTO",
            triggerType,
            scheduledDate: scheduledDate ?? null,
            scheduledTime: scheduledTime ?? null,
            testMode: dto.testMode === true,
        });
        const messageLogModel = this.prisma.message_log as typeof this.prisma.message_log & {
            findUnique?: (args: { where: { providerAcceptanceKey: string } }) => Promise<SmsMessageLogRecord | null>;
        };
        if (typeof messageLogModel.findUnique === "function") {
            const existing = await messageLogModel.findUnique({ where: { providerAcceptanceKey } });
            if (existing) {
                if (existing.providerAcceptanceFingerprint !== providerAcceptanceFingerprint) {
                    throw new ConflictException(
                        this.smsProblemBody(
                            "MESSAGE_REQUEST_KEY_CONFLICT",
                            "NOT_APPLIED",
                        ),
                    );
                }
                return { row: existing, created: false, id: existing.id };
            }
        }

        const data = {
                branchId: branchId || null,
                provider: "aligo_sms",
                templateKey: dto.title?.trim() || "manual_sms",
                receiver: dto.receiver,
                clientId: dto.clientId ?? null,
                recipientName: dto.recipientName ?? null,
                recipientPhone: dto.receiver,
                messageBody: dto.message,
                variables: {
                    recipientName: dto.recipientName ?? null,
                    title: dto.title ?? null,
                    triggerType,
                    msgType: dto.msgType ?? null,
                    employeeId: dto.employeeId ?? null,
                    scheduledDate: scheduledDate ?? null,
                    scheduledTime: scheduledTime ?? null,
                    testMode: dto.testMode ? "true" : "false",
                },
                status: "pending",
                aligoMid: null,
                errorMessage: null,
                attempts: 0,
                lastAttemptAt: null,
                nextRetryAt: null,
                providerAcceptanceKey,
                providerAcceptanceFingerprint,
                providerAcceptanceState: "prepared",
                providerCallStartedAt: null,
                providerAcceptedAt: null,
                providerReconciledAt: null,
                providerReconciledBy: null,
                providerReconciliationReason: null,
            };
        try {
            const row = await this.prisma.message_log.create({ data });
            return { row, created: true, id: row.id };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
                && typeof messageLogModel.findUnique === "function") {
                const existing = await messageLogModel.findUnique({ where: { providerAcceptanceKey } });
                if (existing?.providerAcceptanceFingerprint !== providerAcceptanceFingerprint) {
                    throw new ConflictException(
                        this.smsProblemBody(
                            "MESSAGE_REQUEST_KEY_CONFLICT",
                            "NOT_APPLIED",
                        ),
                    );
                }
                if (existing) return { row: existing, created: false, id: existing.id };
            }
            throw error;
        }
    }

    private async markProviderCallStarted(row: SmsMessageLogRecord): Promise<void> {
        const startedAt = new Date(Date.now());
        const messageLogModel = this.prisma.message_log as typeof this.prisma.message_log & {
            updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
        };
        if (typeof messageLogModel.updateMany !== "function") {
            // Legacy unit doubles do not expose updateMany. Production Prisma
            // always takes the conditional update below; this fallback still
            // keeps the in-memory row fenced for those isolated tests.
            row.providerAcceptanceState = "started";
            row.providerCallStartedAt = startedAt;
            return;
        }
        const claimed = await messageLogModel.updateMany({
            where: {
                id: row.id,
                providerAcceptanceKey: row.providerAcceptanceKey,
                providerAcceptanceFingerprint: row.providerAcceptanceFingerprint,
                providerAcceptanceState: "prepared",
            },
            data: {
                providerAcceptanceState: "started",
                providerCallStartedAt: startedAt,
            },
        });
        if (claimed.count !== 1) {
            throw new ConflictException(
                this.smsProblemBody(
                    "MESSAGE_SEND_ALREADY_REQUESTED",
                    "UNKNOWN",
                    this.safeOperationId(row.id),
                ),
            );
        }
        row.providerAcceptanceState = "started";
        row.providerCallStartedAt = startedAt;
    }

    private async resolveSmsRecipients(
        branchId: string,
        dto: SendSmsMessageDto,
    ): Promise<SendSmsMessageDto> {
        if (!branchId) {
            throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
        }
        if (dto.clientId != null && dto.employeeId != null) {
            throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
        }

        const rawReceivers = dto.receiver
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const normalizedRawReceivers = rawReceivers.map((value) => normalizePhone(value));
        if (normalizedRawReceivers.length === 0 || normalizedRawReceivers.some((value) => !value)) {
            throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
        }
        const normalizedReceivers = Array.from(new Set(normalizedRawReceivers.filter((value): value is string => Boolean(value))));

        type Recipient = { id: number; name: string | null; phone: string; kind: "client" | "employee" };
        const recipients: Recipient[] = [];

        if (dto.clientId != null) {
            if (normalizedReceivers.length !== 1) {
                throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
            }
            const client = await this.prisma.client.findFirst({
                where: { id: dto.clientId, branchId },
                select: { id: true, name: true, phone: true },
            });
            if (!client) {
                throw new NotFoundException(this.smsProblemBody("RESOURCE_NOT_FOUND", "NOT_APPLIED"));
            }
            const phone = normalizePhone(client.phone);
            if (!phone || phone !== normalizedReceivers[0]) {
                throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
            }
            recipients.push({ id: client.id, name: client.name, phone, kind: "client" });
        } else if (dto.employeeId != null) {
            if (normalizedReceivers.length !== 1) {
                throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
            }
            const employeeModel = (this.prisma as PrismaService & { employee?: PrismaService["employee"] }).employee;
            const employee = employeeModel && await employeeModel.findFirst({
                where: { id: dto.employeeId, branchId, deletedAt: null },
                select: { id: true, name: true, phone: true },
            });
            if (!employee) {
                throw new NotFoundException(this.smsProblemBody("RESOURCE_NOT_FOUND", "NOT_APPLIED"));
            }
            const phone = normalizePhone(employee.phone);
            if (!phone || phone !== normalizedReceivers[0]) {
                throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
            }
            recipients.push({ id: employee.id, name: employee.name, phone, kind: "employee" });
        } else {
            for (const phone of normalizedReceivers) {
                const client = await this.findClientByPhone(branchId, phone);
                const employee = await this.findEmployeeByPhone(branchId, phone);
                if (client && employee) {
                    throw new BadRequestException(this.smsProblemBody("REQUEST_INVALID", "NOT_APPLIED"));
                }
                if (!client && !employee) {
                    throw new NotFoundException(this.smsProblemBody("RESOURCE_NOT_FOUND", "NOT_APPLIED"));
                }
                if (client) {
                    recipients.push({ id: client.id, name: client.name, phone, kind: "client" });
                } else if (employee) {
                    recipients.push({ id: employee.id, name: employee.name, phone, kind: "employee" });
                }
            }
        }

        const canonicalName = recipients.length === 1 ? recipients[0]?.name ?? undefined : undefined;
        const clientId = recipients.length === 1 && recipients[0]?.kind === "client" ? recipients[0].id : null;
        const employeeId = recipients.length === 1 && recipients[0]?.kind === "employee" ? recipients[0].id : null;
        return {
            ...dto,
            receiver: recipients.map((recipient) => recipient.phone).join(","),
            recipientName: canonicalName,
            clientId,
            employeeId,
        };
    }

    private async findClientByPhone(branchId: string, phone: string): Promise<{ id: number; name: string | null } | null> {
        const client = await this.prisma.client.findFirst({
            where: { branchId, phone },
            select: { id: true, name: true, phone: true },
        });
        if (client && normalizePhone(client.phone) === phone) {
            return { id: client.id, name: client.name };
        }
        const clientModel = this.prisma.client as typeof this.prisma.client & {
            findMany?: (args: { where: { branchId: string }; select: { id: true; name: true; phone: true } }) => Promise<Array<{ id: number; name: string | null; phone: string | null }>>;
        };
        if (typeof clientModel.findMany !== "function") return null;
        const matches = await clientModel.findMany({ where: { branchId }, select: { id: true, name: true, phone: true } });
        const match = matches.find((candidate) => normalizePhone(candidate.phone) === phone);
        return match ? { id: match.id, name: match.name } : null;
    }

    private async findEmployeeByPhone(branchId: string, phone: string): Promise<{ id: number; name: string | null } | null> {
        const employeeModel = (this.prisma as PrismaService & { employee?: PrismaService["employee"] }).employee;
        if (!employeeModel) return null;
        const employee = await employeeModel.findFirst({
            where: { branchId, phone, deletedAt: null },
            select: { id: true, name: true, phone: true },
        });
        if (employee && normalizePhone(employee.phone) === phone) {
            return { id: employee.id, name: employee.name };
        }
        const employeeModelWithFindMany = employeeModel as typeof employeeModel & {
            findMany?: (args: { where: { branchId: string; deletedAt: null }; select: { id: true; name: true; phone: true } }) => Promise<Array<{ id: number; name: string | null; phone: string | null }>>;
        };
        if (typeof employeeModelWithFindMany.findMany !== "function") return null;
        const matches = await employeeModelWithFindMany.findMany({ where: { branchId, deletedAt: null }, select: { id: true, name: true, phone: true } });
        const match = matches.find((candidate) => normalizePhone(candidate.phone) === phone);
        return match ? { id: match.id, name: match.name } : null;
    }

    private async updateSmsLogFromResult(
        logId: number,
        result: Awaited<ReturnType<AligoService["sendSms"]>>,
        triggerType: string,
        expectedRecipientCount?: number,
        existingVariables?: Prisma.JsonValue | null,
    ): Promise<void> {
        const recipientCount = expectedRecipientCount ?? this.smsRecipientCountFromResult(result);
        const providerOutcome = classifySmsProviderOutcome(result, recipientCount);
        const isAccepted = providerOutcome === "accepted";
        const isPartial = providerOutcome === "partial";
        const isRejected = providerOutcome === "rejected";
        const status = isAccepted
            ? triggerType === "scheduled" ? "pending" : "sent"
            : "failed";
        const response = this.smsResponse(result);
        const request = this.smsRequest(result);
        const successCount = response ? this.smsCounter(response["success_cnt"]) : undefined;
        const errorCount = response ? this.smsCounter(response["error_cnt"]) : undefined;
        const priorVariables = this.isRecord(existingVariables) ? existingVariables : {};
        // Aligo's batch response does not identify failed recipients. Retrying the
        // original receiver list after a partial success would duplicate successful sends.
        const errorMessage = isAccepted
            ? null
            : isPartial
                ? `부분 발송 (성공 ${successCount ?? 0}건 / 실패 ${errorCount ?? 0}건). 실패 수신자를 식별할 수 없어 자동 재전송을 중단했습니다. 실패자에게 수동으로 재발송해 주세요.`
                : isRejected
                    ? this.smsProviderMessage(response)
                    : "문자 발송 결과를 확인할 수 없어 자동 재전송을 중단했습니다.";

        const updateData: Record<string, unknown> = {
            status,
            aligoMid: this.smsProviderMessageId(response),
            errorMessage,
            providerAcceptanceState: isAccepted
                ? "accepted"
                : isRejected
                    ? "rejected"
                    : "uncertain",
            providerAcceptedAt: isAccepted ? new Date(Date.now()) : null,
            attempts: 1,
            lastAttemptAt: new Date(),
            // A manual delivery response is never retried automatically. A
            // provider rejection remains eligible for a separately authorized
            // history retry; partial and unknown outcomes are terminal until
            // an operator can identify a safe recipient-level action.
            nextRetryAt: null,
            variables: {
                ...priorVariables,
                triggerType,
                msgType: request?.["msgType"] ?? null,
                scheduledDate: request?.["scheduledDate"] ?? null,
                scheduledTime: request?.["scheduledTime"] ?? null,
                testMode: request?.["testModeYn"] === "Y" ? "true" : "false",
                retrySafety: isAccepted
                    ? "delivered"
                    : isPartial
                        ? SMS_PARTIAL_RETRY_SAFETY
                        : isRejected
                            ? SMS_MANUAL_PROVIDER_REJECTED_RETRY_SAFETY
                            : "uncertain",
            },
        };
        const receiver = request?.["receiver"];
        if (typeof receiver === "string" && receiver.trim()) {
            updateData["receiver"] = receiver;
            updateData["recipientPhone"] = receiver;
        }

        await this.updateSmsLog(logId, updateData);
    }

    private async updateSmsLog(
        logId: number,
        data: Record<string, unknown>,
    ): Promise<void> {
        await this.prisma.message_log.update({
            where: { id: logId },
            data,
        });
    }

    private smsResponse(result: unknown): Record<string, unknown> | null {
        if (!this.isRecord(result)) {
            return null;
        }
        const response = result["response"];
        return this.isRecord(response) ? response : null;
    }

    private smsRequest(result: unknown): Record<string, unknown> | null {
        if (!this.isRecord(result)) {
            return null;
        }
        const request = result["request"];
        return this.isRecord(request) ? request : null;
    }

    private smsInteger(value: unknown): number | undefined {
        if (typeof value === "number") {
            return Number.isInteger(value) && Number.isFinite(value) ? value : undefined;
        }
        if (typeof value !== "string" || !value.trim()) {
            return undefined;
        }
        const normalized = value.trim();
        if (!/^-?\d+$/.test(normalized)) {
            return undefined;
        }
        const parsed = Number(normalized);
        return Number.isInteger(parsed) && Number.isFinite(parsed) ? parsed : undefined;
    }

    private smsCounter(value: unknown): number | undefined {
        const parsed = this.smsInteger(value);
        return parsed !== undefined && parsed >= 0 ? parsed : undefined;
    }

    private smsRecipientCountFromResult(result: unknown): number {
        const receiver = this.smsRequest(result)?.["receiver"];
        return typeof receiver === "string" ? this.countSmsRecipients(receiver) : 0;
    }

    private smsResultCodeForLog(result: unknown): string {
        const parsed = this.smsInteger(this.smsResponse(result)?.["result_code"]);
        return parsed === undefined ? "unknown" : String(parsed);
    }

    private smsErrorCountForLog(result: unknown): string {
        const parsed = this.smsCounter(this.smsResponse(result)?.["error_cnt"]);
        return parsed === undefined ? "unknown" : String(parsed);
    }

    private smsProviderMessage(response: Record<string, unknown> | null): string {
        const message = response?.["message"];
        return typeof message === "string" && message.trim()
            ? message
            : "문자 발송 요청이 공급자에 의해 거부되었습니다.";
    }

    private smsProviderMessageId(response: Record<string, unknown> | null): string | null {
        const messageId = response?.["msg_id"];
        if (typeof messageId !== "string" && typeof messageId !== "number") {
            return null;
        }
        const normalized = String(messageId).trim();
        return normalized || null;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    private smsRecordVariables(row: SmsMessageLogRecord): Record<string, unknown> {
        return this.isRecord(row.variables) ? row.variables : {};
    }

    private smsProblemBody(
        code: SmsProblemCode,
        outcome: ProblemOutcome,
        operationId?: string,
    ): SmsProblemBody {
        const body: SmsProblemBody = {
            code,
            params: {},
            outcome,
            recovery: {
                action: outcome === "UNKNOWN" || outcome === "PARTIALLY_APPLIED"
                    ? "CHECK_STATUS"
                    : "NONE",
                retry: { mode: "NEVER" },
            },
        };
        if (operationId) {
            body.operationId = operationId;
        }
        return body;
    }

    private safeOperationId(value: unknown): string | undefined {
        const candidate = typeof value === "number" && Number.isInteger(value)
            ? String(value)
            : typeof value === "string"
                ? value
                : undefined;
        if (!candidate || candidate.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
            return undefined;
        }
        return candidate;
    }

    private countSmsRecipients(receiver: string): number {
        return receiver
            .split(",")
            .map((phone) => phone.trim())
            .filter(Boolean).length;
    }

    private assertScheduledAtLeastTenMinutesAhead(
        scheduledDate?: string,
        scheduledTime?: string,
    ) {
        const scheduledAt = parseKstSchedule(scheduledDate, scheduledTime);
        if (!scheduledAt) {
            throw new BadRequestException("예약 발송 일시 형식이 올바르지 않습니다.");
        }
        if (scheduledAt.getTime() - Date.now() < ALIGO_SCHEDULE_MIN_LEAD_MS) {
            throw new BadRequestException(
                "예약 발송은 한국시간 기준 현재 시각보다 10분 이후만 등록할 수 있습니다.",
            );
        }
    }

    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        const message = String(error ?? "").trim();
        return message || "문자 발송 요청이 실패했습니다.";
    }

}
