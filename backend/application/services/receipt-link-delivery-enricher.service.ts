import type { Prisma } from "@prisma/client";
import { isManualMessageTriggerJob, isManualMessageTriggerRule } from "domain/constants/message-trigger-job-ownership";
import { RECEIPT_RECOVERY_PREFIX } from "domain/constants/receipt-job-recovery";
import { isReservedAutomationJob } from "domain/constants/agent-automation-storage";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "domain/constants/sms-delivery-snapshot";
import { Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { RECEIPT_LINK_KIND, RECEIPT_LINK_TOKEN_REPOSITORY, type IReceiptLinkTokenRepository } from "domain/repositories/receipt-link-token.repository.interface";
import {
    FILE_STORAGE_PORT,
    FileStorageObjectNotFoundError,
    FileStoragePort,
} from "domain/ports/file-storage.port";
import {
    ReceiptLinkIssueService,
    type ReceiptDocumentGeneration,
    ReceiptLinkSkipError,
    receiptLinkUnusableError,
} from "./receipt-link-issue.service";
import { isStandaloneReceiptJob, standaloneReceiptReference } from "domain/entities/standalone-receipt-request";
import { StandaloneReceiptPreparationService } from "./standalone-receipt-preparation.service";
import { ReceiptLinkTokenService } from "./receipt-link-token.service";
import {
    SmsTriggerPayloadEnricher,
    type ReceiptReadiness,
    SmsTriggerPayloadEnricherRegistry,
} from "./sms-trigger-payload-enricher.registry";

import {
    MANUAL_DEDUPE_MARKER,
    SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY,
    SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE,
} from "domain/constants/service-end-notice-message";
export { MANUAL_DEDUPE_MARKER } from "domain/constants/service-end-notice-message";

/** Refreshes the contract receipt link at delivery time to a new 30-day expiry counted from this send. */
@Injectable()
export class ReceiptLinkDeliveryEnricher implements SmsTriggerPayloadEnricher, OnModuleInit {
    private readonly prepared = new WeakMap<MessageTriggerJobEntity, ReceiptDocumentGeneration>();

    constructor(
        private readonly registry: SmsTriggerPayloadEnricherRegistry,
        private readonly issueService: ReceiptLinkIssueService,
        @Optional()
        private readonly tokenService?: ReceiptLinkTokenService,
        @Optional()
        @Inject(FILE_STORAGE_PORT)
        private readonly storage?: FileStoragePort,
        @Optional()
        @Inject(RECEIPT_LINK_TOKEN_REPOSITORY)
        private readonly tokenRepository?: IReceiptLinkTokenRepository,
        @Optional()
        private readonly standalone?: StandaloneReceiptPreparationService,
    ) {}

    onModuleInit(): void {
        this.registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, this);
    }

    async enrich(job: MessageTriggerJobEntity): Promise<void> {
        if (isStandaloneReceiptJob(job)) {
            if (!this.standalone) throw receiptLinkUnusableError();
            await this.standalone.resolve(job, true);
            const reference = standaloneReceiptReference(job.id);
            job.payload.templateVariables[SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE] = reference;
            job.payload[SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY] = reference;
            return;
        }
        if (!job.branchId || !job.clientId) {
            throw new ReceiptLinkSkipError("no_contract_document");
        }
        const existingUrl = job.payload.templateVariables?.[SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE];
        const receiptEformsignDocId = job.payload.receiptEformsignDocId;
        const observeRecovery = this.isAutomaticReceipt(job);
        const issued = await this.issueService.issue({
            ...(observeRecovery ? { observeRecovery, onPrepared: (generation: ReceiptDocumentGeneration) => this.prepared.set(job, generation) } : {}),
            branchId: job.branchId,
            clientId: job.clientId,
            source: job.dedupeKey.includes(MANUAL_DEDUPE_MARKER) ? "manual" : "auto_trigger",
            jobId: job.id,
            createdBy: job.payload.sentByUserId ?? null,
            ...(typeof receiptEformsignDocId === "number" ? { eformsignDocId: receiptEformsignDocId } : {}),
            ...(typeof existingUrl === "string" && existingUrl.length > 0 ? { existingUrl } : {}),
        });
        job.payload.templateVariables[SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE] = issued.url;
        job.payload[SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY] = issued.url;
    }

    async resolveStandaloneReceiptUrl(job: MessageTriggerJobEntity): Promise<string> {
        const reference = standaloneReceiptReference(job.id);
        if (!this.standalone || !isStandaloneReceiptJob(job)
            || job.payload.templateVariables[SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE] !== reference
            || job.payload[SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY] !== reference) {
            throw receiptLinkUnusableError();
        }
        return this.issueService.buildReceiptUrl(await this.standalone.resolve(job, false));
    }

    async validateStandaloneHandoff(job: MessageTriggerJobEntity, url: string, tx: Prisma.TransactionClient): Promise<void> {
        if (!this.standalone || this.issueService.buildReceiptUrl(await this.standalone.assertHandoff(job, tx)) !== url) {
            throw receiptLinkUnusableError();
        }
    }

    private isAutomaticReceipt(job: MessageTriggerJobEntity): boolean {
        return job.recipientType === MessageTriggerRecipientType.CLIENT
            && job.employeeScheduleId === null
            && !isManualMessageTriggerJob(job)
            && !isManualMessageTriggerRule({ id: job.ruleId, templateKey: job.templateKey })
            && !isReservedAutomationJob(job)
            && typeof job.payload.receiptEformsignDocId !== "number";
    }

    receiptSnapshotProof(job: MessageTriggerJobEntity) {
        const generation = this.prepared.get(job);
        return generation ? { ...generation, sourceUpdatedDate: generation.sourceUpdatedDate.toISOString() } : undefined;
    }

    private readPersistedGeneration(job: MessageTriggerJobEntity): ReceiptDocumentGeneration | "legacy" | undefined {
        try {
            const snapshot = JSON.parse(job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] ?? "null");
            if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return;
            if (!Object.prototype.hasOwnProperty.call(snapshot, "receiptGeneration")) return "legacy";
            const { receiptGeneration } = snapshot;
            if (!receiptGeneration || !Number.isSafeInteger(receiptGeneration.documentId)
                || typeof receiptGeneration.sourceUpdatedDate !== "string"
                || typeof receiptGeneration.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(receiptGeneration.sha256)) return;
            const sourceUpdatedDate = new Date(receiptGeneration.sourceUpdatedDate);
            if (!Number.isFinite(sourceUpdatedDate.getTime())) return;
            return { documentId: receiptGeneration.documentId, sourceUpdatedDate, sha256: receiptGeneration.sha256 };
        } catch {
            return undefined;
        }
    }

    async checkRecovery(branchId: string, clientId: number, documentId: number | null,
        transaction: Prisma.TransactionClient, preparedJob?: MessageTriggerJobEntity): Promise<ReceiptReadiness> {
        if (!preparedJob) return this.issueService.checkRecovery(branchId, clientId, documentId, transaction);

        if (preparedJob.branchId !== branchId || preparedJob.clientId !== clientId) return { kind: "terminal" };
        const generation = this.readPersistedGeneration(preparedJob);
        if (!generation) return { kind: "terminal" };
        // Pre-rollout ordinary snapshots bind the image through the persisted
        // contract token. Recovered jobs also need their prepared generation.
        if (generation === "legacy" && (documentId !== null || preparedJob.dedupeKey.startsWith(RECEIPT_RECOVERY_PREFIX))) {
            return { kind: "terminal" };
        }
        const preparedDocumentId = generation === "legacy"
            ? (await this.readActiveStagedToken(preparedJob, transaction))?.eformsignDocId
            : generation.documentId;
        if (preparedDocumentId == null || (documentId !== null && documentId !== preparedDocumentId)) {
            return { kind: "terminal" };
        }
        const readiness = await this.issueService.checkRecovery(branchId, clientId, preparedDocumentId, transaction, generation);
        if (readiness.kind !== "ready") return readiness;
        // Sample token validity again after waiting for document locks and reading the PDF.
        const token = await this.readActiveStagedToken(preparedJob, transaction);
        return token?.eformsignDocId === preparedDocumentId ? readiness : { kind: "terminal" };
    }

    private async readActiveStagedToken(job: MessageTriggerJobEntity, transaction?: Prisma.TransactionClient) {
        const linkToken = this.readStagedLinkToken(job);
        if (!linkToken || !job.branchId || job.clientId === null) return null;
        return await this.tokenRepository?.findActiveContractForDelivery?.({
            linkTokenHash: createHash("sha256").update(linkToken).digest("hex"),
            branchId: job.branchId,
            clientId: job.clientId,
            now: new Date(),
        }, transaction) ?? null;
    }

    private readStagedLinkToken(job: MessageTriggerJobEntity): string | undefined {
        const receiptUrl = job.payload.templateVariables[SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE];
        if (!receiptUrl) return;
        try {
            return new URL(receiptUrl).pathname.match(/^\/receipt\/(efr_[A-Za-z0-9_-]+)\/?$/)?.[1];
        } catch {
            return undefined;
        }
    }

    async validateStagedSnapshot(job: MessageTriggerJobEntity): Promise<void> {
        if (isStandaloneReceiptJob(job)) {
            await this.resolveStandaloneReceiptUrl(job);
            return;
        }
        const branchId = job.branchId;
        const clientId = job.clientId;
        if (!branchId || clientId === null) throw receiptLinkUnusableError();

        const automatic = this.isAutomaticReceipt(job);
        let staged: { eformsignDocId?: number | null; storagePath: string } | null;
        if (automatic) {
            const token = await this.readActiveStagedToken(job);
            if (token?.eformsignDocId == null) throw receiptLinkUnusableError();
            staged = token;
        } else {
            const linkToken = this.readStagedLinkToken(job);
            if (!linkToken || !this.tokenService) throw receiptLinkUnusableError();
            const status = await this.tokenService.getStatus(linkToken, new Date());
            if (status.ok && status.kind === RECEIPT_LINK_KIND.STANDALONE) throw receiptLinkUnusableError();
            staged = status.ok ? status : null;
        }
        const assertDocumentSyncReady = this.issueService.assertDocumentSyncReady;
        if (typeof assertDocumentSyncReady === "function") {
            const explicitDocId = job.payload.receiptEformsignDocId;
            // The issue service resolves the client's authoritative contract
            // when no explicit manual-send document was pinned. This check is
            // deliberately before signing the object URL or handing control
            // back to the SMS provider. For an automatic job the approved link
            // was rendered from one specific contract; it is only deliverable
            // while that contract is still the current one (the readiness
            // result describes the current contract, never the link's own).
            await assertDocumentSyncReady.call(this.issueService, {
                branchId,
                clientId,
                ...(typeof explicitDocId === "number" ? { eformsignDocId: explicitDocId } : {}),
                ...(typeof explicitDocId !== "number" && staged?.eformsignDocId != null
                    ? { expectedEformsignDocId: staged.eformsignDocId }
                    : {}),
                ...(automatic ? { automatic: true } : {}),
            });
        }
        if (!staged || !this.storage) {
            throw receiptLinkUnusableError();
        }
        try {
            await this.storage.createSignedUrl(staged.storagePath);
        } catch (error) {
            if (error instanceof FileStorageObjectNotFoundError) {
                throw receiptLinkUnusableError();
            }
            throw error;
        }
    }
}
