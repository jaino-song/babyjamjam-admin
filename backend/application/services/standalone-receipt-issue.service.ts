import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { isUUID } from "class-validator";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MANUAL_DEDUPE_MARKER, SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import type { MessageTriggerJobPayload } from "domain/entities/message-trigger-job.entity";
import type { StandaloneReceiptRequest, StandaloneReceiptSnapshot } from "domain/entities/standalone-receipt-request";
import { IMessageTriggerRuleRepository, MESSAGE_TRIGGER_RULE_REPOSITORY } from "domain/repositories/message-trigger-rule.repository.interface";
import { isoDateInKorea } from "domain/utils/business-days";
import { normalizePhone } from "domain/utils/normalize-phone";
import { PhoneNumber } from "domain/value-objects/phone-number.vo";
import { normalizeKoreanWon } from "domain/value-objects/money.vo";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import {
    isStandaloneReceiptDate, STANDALONE_RECEIPT_MAX_KRW, validateStandaloneReceiptSnapshot,
} from "infrastructure/pdf/standalone-receipt-renderer";
import {
    StandaloneReceiptTemplateLoader, StandaloneReceiptTemplateUnavailableError,
} from "infrastructure/pdf/standalone-receipt-template.loader";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import { buildManualReceiptLinkRule } from "./receipt-link-manual-send.service";
import { normalizeBirthdayInput, ReceiptLinkTokenService } from "./receipt-link-token.service";

interface StandaloneReceiptInput {
    branchId: string;
    userId: string;
    clientId: number;
    copaymentReceivedDate: string;
    requestId: string;
}

const clientFields = {
    id: true, name: true, phone: true, birthday: true, startDate: true, endDate: true,
    fullPrice: true, grant: true, actualPrice: true, serviceStatus: true,
} satisfies Prisma.clientSelect;
type ReceiptClient = Prisma.clientGetPayload<{ select: typeof clientFields }>;

function missingFields() {
    return new BadRequestException({ code: "MISSING_RECEIPT_FIELDS" });
}

function amount(value: string | null): number {
    const normalized = normalizeKoreanWon(value);
    if (normalized === null || BigInt(normalized) > BigInt(STANDALONE_RECEIPT_MAX_KRW)) throw missingFields();
    return Number(normalized);
}

function snapshot(client: ReceiptClient, receivedDate: string, at: Date): StandaloneReceiptSnapshot {
    try {
        const receipt = {
            customerName: client.name,
            serviceStartDate: client.startDate?.toISOString().slice(0, 10) ?? "",
            endDate: client.endDate?.toISOString().slice(0, 10) ?? "",
            receivedDate,
            issueDate: isoDateInKorea(at),
            fullPrice: amount(client.fullPrice),
            grant: amount(client.grant),
            actualPrice: amount(client.actualPrice),
        };
        validateStandaloneReceiptSnapshot(receipt);
        return receipt;
    } catch {
        throw missingFields();
    }
}

function receiptBirthday(value: string | null): string | null {
    const normalized = normalizeBirthdayInput(value ?? "");
    if (!normalized) return null;
    const full = normalized.length === 6 ? `20${normalized}` : normalized;
    const formatted = `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6)}`;
    const date = new Date(`${formatted}T00:00:00Z`);
    return !formatted.startsWith("0000-") && Number.isFinite(date.getTime())
        && date.toISOString().slice(0, 10) === formatted ? normalized : null;
}

function accepted(jobId: string): { jobId: string; queued: true } {
    return { jobId, queued: true };
}

@Injectable()
export class StandaloneReceiptIssueService {
    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE) private readonly prisma: MessageAutomationDatabase,
        private readonly senderApproval: MessageSenderApprovalService,
        private readonly loader: StandaloneReceiptTemplateLoader,
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly rules: IMessageTriggerRuleRepository,
    ) {}

    async issue(input: StandaloneReceiptInput): Promise<{ jobId: string; queued: true }> {
        if (!isStandaloneReceiptDate(input.copaymentReceivedDate)) {
            throw new BadRequestException({ code: "INVALID_RECEIVED_DATE" });
        }
        if (!Number.isSafeInteger(input.clientId) || input.clientId < 1 || input.clientId > 2_147_483_647
            || typeof input.requestId !== "string" || !isUUID(input.requestId)) throw missingFields();
        const { branchId, clientId, copaymentReceivedDate, userId } = input;
        const requestId = input.requestId.toLowerCase();
        const denied = () => new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        const notFound = () => new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        const clientWhere = { id: clientId, branchId, deletedAt: null };
        const bindingWhere = { branchId, standaloneRequestId: requestId };
        const bindingSelect = { id: true, payload: true };

        const branch = await this.prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } });
        if (!branch) throw denied();
        await this.senderApproval.ensureApproved(branchId);
        if (!await this.prisma.client.findFirst({ where: clientWhere, select: { id: true } })) throw notFound();

        let existing = await this.prisma.message_trigger_job.findFirst({ where: bindingWhere, select: bindingSelect });
        if (!existing) {
            try {
                await this.loader.load(branchId);
            } catch (error) {
                if (!(error instanceof StandaloneReceiptTemplateUnavailableError)) throw error;
                existing = await this.prisma.message_trigger_job.findFirst({ where: bindingWhere, select: bindingSelect });
                if (!existing) throw denied();
            }
        }

        return this.prisma.$transaction(async tx => {
            const [issuer] = await tx.$queryRaw<Array<{ name: string }>>`
                SELECT name FROM "branch" WHERE id = ${branchId}::uuid AND is_active
                    AND sms_sender_approval_status = 'approved' FOR SHARE
            `;
            if (!issuer) throw denied();

            const visible = await tx.$queryRaw<Array<{ id: number }>>`
                SELECT id FROM "client" WHERE id = ${clientId} AND branch_id = ${branchId}::uuid
                    AND deleted_at IS NULL FOR UPDATE
            `;
            if (!visible.length) throw notFound();

            const replay = (binding: { id: string; payload: Prisma.JsonValue }) => {
                const request = (binding.payload as unknown as MessageTriggerJobPayload | null)?.standaloneReceipt;
                if (request?.version !== 1 || request.requestId !== requestId || request.branchId !== branchId
                    || request.jobId !== binding.id || request.clientId !== clientId || request.receipt?.receivedDate !== copaymentReceivedDate) {
                    throw new ConflictException({ code: "REQUEST_ID_CONFLICT" });
                }
                return accepted(binding.id);
            };
            const binding = await tx.message_trigger_job.findFirst({ where: bindingWhere, select: bindingSelect });
            if (binding) return replay(binding);
            // A preliminary replay lookup never authorizes a fresh insertion.
            if (existing) throw new ConflictException({ code: "REQUEST_ID_CONFLICT" });

            const client = await tx.client.findFirst({ where: clientWhere, select: clientFields });
            if (!client) throw notFound();
            const birthday = receiptBirthday(client.birthday);
            const phone = normalizePhone(client.phone);
            if (!birthday || !phone || !PhoneNumber.create(phone) || !issuer.name.trim() || client.serviceStatus === "terminated") {
                throw missingFields();
            }

            const at = new Date();
            const receipt = snapshot(client, copaymentReceivedDate, at);
            const jobId = randomUUID();
            const request: StandaloneReceiptRequest = {
                version: 1, requestId, jobId, branchId, clientId, receipt, recipientPhone: phone,
                issuerName: issuer.name, expectedBirthdayHash: this.tokenService.hashBirthday(birthday),
                acceptedBy: userId, acceptedAt: at.toISOString(), nonce: randomBytes(32).toString("hex"), artifactId: randomUUID(),
            };
            const payload: MessageTriggerJobPayload = {
                standaloneReceipt: request, clientId, clientName: client.name, memberId: `client:${clientId}`,
                recipientName: client.name, recipientPhone: phone, sentByUserId: userId,
                templateVariables: { name: client.name, clientName: client.name, phone },
            };
            await this.rules.ensureSystemRule(buildManualReceiptLinkRule(at), tx);

            const inserted = await tx.$executeRaw`
                INSERT INTO "message_trigger_job" (
                    id, branch_id, rule_id, status, scheduled_for, client_id, recipient_type, recipient_phone,
                    template_key, dedupe_key, payload, standalone_request_id, created_at, updated_at
                ) VALUES (
                    ${jobId}, ${branchId}::uuid, ${SERVICE_END_NOTICE_RULE_ID}, 'pending', ${at}, ${clientId},
                    ${MessageTriggerRecipientType.CLIENT}, ${phone}, ${MessageTriggerTemplateKey.SERVICE_END_NOTICE},
                    ${`${SERVICE_END_NOTICE_RULE_ID}:client:${clientId}${MANUAL_DEDUPE_MARKER}${jobId}`},
                    ${JSON.stringify(payload)}::jsonb, ${requestId}::uuid, ${at}, ${at}
                )
                ON CONFLICT (branch_id, standalone_request_id) WHERE standalone_request_id IS NOT NULL DO NOTHING
            `;
            if (inserted === 0) {
                // READ COMMITTED takes a fresh snapshot after ON CONFLICT waited for the winner.
                const winner = await tx.message_trigger_job.findFirstOrThrow({ where: bindingWhere, select: bindingSelect });
                return replay(winner);
            }
            await tx.client.update({ where: clientWhere, data: { copaymentReceivedDate: new Date(`${copaymentReceivedDate}T00:00:00Z`) } });
            return accepted(jobId);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }
}
