import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type receipt_link_token } from "@prisma/client";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isUUID } from "class-validator";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import { getReceiptLinkExpiresAt } from "domain/constants/receipt-link-expiry";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { MANUAL_DEDUPE_MARKER, SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import type { MessageTriggerJobEntity, MessageTriggerJobPayload } from "domain/entities/message-trigger-job.entity";
import type { StandaloneReceiptRequest } from "domain/entities/standalone-receipt-request";
import { RECEIPT_LINK_KIND, RECEIPT_LINK_TOKEN_REPOSITORY } from "domain/repositories/receipt-link-token.repository.interface";
import { STANDALONE_RECEIPT_STORAGE, FileStorageObjectNotFoundError, type StandaloneReceiptStorage } from "domain/ports/file-storage.port";
import { MESSAGE_AUTOMATION_DATABASE, type MessageAutomationDatabase } from "domain/repositories/message-automation-database.repository.interface";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { StandaloneReceiptRenderer } from "infrastructure/pdf/standalone-receipt-renderer";
import { StandaloneReceiptTemplateLoader, StandaloneReceiptTemplateUnavailableError } from "infrastructure/pdf/standalone-receipt-template.loader";
import { ReceiptLinkTokenService } from "./receipt-link-token.service";
import { SmsTriggerDeliverySkipError } from "./sms-trigger-payload-enricher.registry";

function unusable() {
    return new SmsTriggerDeliverySkipError("standalone_receipt_unusable");
}

function digest(bytes: Buffer) {
    return createHash("sha256").update(bytes).digest("hex");
}

const jobFields = { payload: true, standaloneIssuedTokenId: true, recipientPhone: true } satisfies Prisma.message_trigger_jobSelect;
type StoredJob = Prisma.message_trigger_jobGetPayload<{ select: typeof jobFields }>;

@Injectable()
export class StandaloneReceiptPreparationService {
    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE) private readonly prisma: MessageAutomationDatabase,
        @Inject(RECEIPT_LINK_TOKEN_REPOSITORY) private readonly tokens: SbReceiptLinkTokenRepository,
        private readonly tokenService: ReceiptLinkTokenService,
        private readonly loader: StandaloneReceiptTemplateLoader,
        private readonly renderer: StandaloneReceiptRenderer,
        @Inject(STANDALONE_RECEIPT_STORAGE) private readonly storage: StandaloneReceiptStorage,
    ) {}

    private verifyRequest(job: MessageTriggerJobEntity): StandaloneReceiptRequest {
        const request = job.payload.standaloneReceipt;
        if (!request || request.version !== 1 || !job.standaloneRequestId || request.requestId !== job.standaloneRequestId
            || !isUUID(request.jobId) || !isUUID(request.branchId) || !isUUID(request.artifactId)
            || request.jobId !== job.id || request.branchId !== job.branchId || request.clientId !== job.clientId
            || request.clientId !== job.payload.clientId || request.recipientPhone !== job.recipientPhone
            || request.recipientPhone !== job.payload.recipientPhone || request.acceptedBy !== job.payload.sentByUserId
            || !request.receipt || request.receipt.customerName !== job.payload.recipientName
            || !/^[a-f0-9]{64}$/.test(request.nonce) || !/^[a-f0-9]{64}$/.test(request.expectedBirthdayHash)
            || !Number.isFinite(Date.parse(request.acceptedAt))
            || job.ruleId !== SERVICE_END_NOTICE_RULE_ID || job.templateKey !== MessageTriggerTemplateKey.SERVICE_END_NOTICE
            || job.recipientType !== MessageTriggerRecipientType.CLIENT || job.employeeScheduleId !== null
            || !isManualMessageTriggerJob(job)
            || job.dedupeKey !== `${SERVICE_END_NOTICE_RULE_ID}:client:${request.clientId}${MANUAL_DEDUPE_MARKER}${job.id}`
            || job.payload.receiptEformsignDocId !== undefined || job.payload.agentAutomationSeal
            || job.payload.taskAutomationReference) throw unusable();
        return request;
    }

    private async storedJob(db: Prisma.TransactionClient, request: StandaloneReceiptRequest): Promise<StoredJob> {
        const row = await db.message_trigger_job.findFirst({
            where: {
                id: request.jobId, branchId: request.branchId, clientId: request.clientId,
                standaloneRequestId: request.requestId, ruleId: SERVICE_END_NOTICE_RULE_ID,
                templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
                dedupeKey: `${SERVICE_END_NOTICE_RULE_ID}:client:${request.clientId}${MANUAL_DEDUPE_MARKER}${request.jobId}`,
                recipientType: MessageTriggerRecipientType.CLIENT, employeeScheduleId: null,
            },
            select: jobFields,
        });
        if (!row || row.recipientPhone !== request.recipientPhone
            || !isDeepStrictEqual((row.payload as unknown as MessageTriggerJobPayload | null)?.standaloneReceipt, request)) {
            throw unusable();
        }
        const client = await db.client.findFirst({
            where: { id: request.clientId, branchId: request.branchId, deletedAt: null }, select: { id: true },
        });
        if (!client) throw unusable();
        return row;
    }

    private async findToken(db: Prisma.TransactionClient, request: StandaloneReceiptRequest) {
        return db.receipt_link_token.findFirst({
            where: { jobId: request.jobId, branchId: request.branchId, kind: RECEIPT_LINK_KIND.STANDALONE },
        });
    }

    private verifyToken(row: receipt_link_token | null, marker: string | null, request: StandaloneReceiptRequest,
        linkTokenHash: string, path: string, expiresAt: Date, expected?: { contentSha256: string; byteSize: number }): receipt_link_token {
        if (!row || row.id !== marker || !row.active || row.revokedAt || expiresAt <= new Date()
            || row.jobId !== request.jobId || row.branchId !== request.branchId || row.clientId !== request.clientId
            || row.kind !== RECEIPT_LINK_KIND.STANDALONE || row.source !== "manual" || row.eformsignDocId !== null
            || row.linkTokenHash !== linkTokenHash || row.storagePath !== path || row.expiresAt.getTime() !== expiresAt.getTime()
            || row.expectedBirthdayHash !== request.expectedBirthdayHash || row.frozenClientName !== request.receipt.customerName
            || !/^[a-f0-9]{64}$/.test(row.contentSha256) || row.byteSize <= 0
            || (expected && (row.contentSha256 !== expected.contentSha256 || row.byteSize !== expected.byteSize))) {
            throw unusable();
        }
        return row;
    }

    private async verifyObject(path: string, proof: { contentSha256: string; byteSize: number }, uploading = false): Promise<void> {
        let bytes: Buffer;
        try {
            bytes = await this.storage.download(path);
        } catch (error) {
            if (error instanceof FileStorageObjectNotFoundError && !uploading) throw unusable();
            throw new TriggerJobDeferredError("transient", "Standalone receipt object could not be read");
        }
        if (bytes.byteLength !== proof.byteSize || digest(bytes) !== proof.contentSha256) throw unusable();
    }

    /** Recheck the exact link and recipient under locks held through provider admission. */
    async assertHandoff(job: MessageTriggerJobEntity, tx: Prisma.TransactionClient): Promise<string> {
        const request = this.verifyRequest(job);
        const clients = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT id FROM "client" WHERE id = ${request.clientId}
                AND branch_id = ${request.branchId}::uuid AND deleted_at IS NULL FOR SHARE
        `;
        if (!clients.length) throw unusable();
        const stored = await this.storedJob(tx, request);
        if (!stored.standaloneIssuedTokenId) throw unusable();
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "receipt_link_token"
            WHERE id = ${stored.standaloneIssuedTokenId}::uuid AND branch_id = ${request.branchId}::uuid
                AND client_id = ${request.clientId} AND job_id = ${request.jobId} AND kind = 'standalone'
            FOR SHARE
        `;
        if (!locked.length) throw unusable();
        const { linkToken, linkTokenHash } = this.tokenService.deriveStandaloneLink(request);
        this.verifyToken(await this.findToken(tx, request), stored.standaloneIssuedTokenId, request, linkTokenHash,
            `receipts/${request.branchId}/standalone/${request.artifactId}.png`, getReceiptLinkExpiresAt(new Date(request.acceptedAt)));
        return linkToken;
    }

    async resolve(job: MessageTriggerJobEntity, allowIssuance: boolean): Promise<string> {
        const request = this.verifyRequest(job);
        const createdAt = new Date(request.acceptedAt);
        const expiresAt = getReceiptLinkExpiresAt(createdAt);
        if (expiresAt <= new Date()) throw unusable();
        const { linkToken, linkTokenHash } = this.tokenService.deriveStandaloneLink(request);
        const storagePath = `receipts/${request.branchId}/standalone/${request.artifactId}.png`;
        const stored = await this.storedJob(this.prisma, request);
        if (stored.standaloneIssuedTokenId || !allowIssuance) {
            const row = this.verifyToken(await this.findToken(this.prisma, request), stored.standaloneIssuedTokenId,
                request, linkTokenHash, storagePath, expiresAt);
            await this.verifyObject(storagePath, row);
            return linkToken;
        }

        const racedToken = await this.findToken(this.prisma, request);
        if (racedToken) {
            const winner = await this.storedJob(this.prisma, request);
            const row = this.verifyToken(racedToken, winner.standaloneIssuedTokenId, request, linkTokenHash, storagePath, expiresAt);
            await this.verifyObject(storagePath, row);
            return linkToken;
        }

        let template: Buffer;
        try {
            template = await this.loader.load(request.branchId);
        } catch (error) {
            if (error instanceof StandaloneReceiptTemplateUnavailableError) {
                throw new SmsTriggerDeliverySkipError("standalone_receipt_template_unavailable");
            }
            throw new Error("Standalone receipt template could not be read");
        }
        let bytes: Buffer;
        try {
            bytes = await this.renderer.render(template, request.receipt);
        } catch {
            throw new SmsTriggerDeliverySkipError("standalone_receipt_render_failed");
        }
        const proof = { contentSha256: digest(bytes), byteSize: bytes.byteLength };
        try {
            await this.storage.createPrivateObject(bytes, storagePath, "image/png");
        } catch {
            // A lost acknowledgement or another worker can leave this exact object in place.
            // Its proof, never the upload response, is the source of truth.
        }
        await this.verifyObject(storagePath, proof, true);

        await this.prisma.$transaction(async tx => {
            const clients = await tx.$queryRaw<Array<{ id: number }>>`
                SELECT id FROM "client" WHERE id = ${request.clientId}
                    AND branch_id = ${request.branchId}::uuid AND deleted_at IS NULL FOR SHARE
            `;
            if (!clients.length) throw unusable();
            await tx.$queryRaw`
                SELECT id FROM "message_trigger_job" WHERE id = ${request.jobId}
                    AND branch_id = ${request.branchId}::uuid FOR UPDATE
            `;
            const locked = await this.storedJob(tx, request);
            if (locked.standaloneIssuedTokenId) {
                this.verifyToken(await this.findToken(tx, request), locked.standaloneIssuedTokenId,
                    request, linkTokenHash, storagePath, expiresAt, proof);
                return;
            }
            if (expiresAt <= new Date()) throw unusable();
            const token = await this.tokens.insertStandaloneLink({
                branchId: request.branchId, clientId: request.clientId, jobId: request.jobId,
                linkTokenHash, expectedBirthdayHash: request.expectedBirthdayHash,
                frozenClientName: request.receipt.customerName, storagePath, ...proof,
                createdAt, expiresAt, createdBy: request.acceptedBy,
            }, tx);
            const marked = await tx.$executeRaw`
                UPDATE "message_trigger_job" SET standalone_issued_token_id = ${token.id}::uuid
                WHERE id = ${request.jobId} AND branch_id = ${request.branchId}::uuid
                    AND standalone_issued_token_id IS NULL
            `;
            if (marked !== 1) throw unusable();
        });
        return linkToken;
    }
}
