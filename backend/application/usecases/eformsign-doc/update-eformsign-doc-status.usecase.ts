import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import {
    EFORMSIGN_DOC_REPOSITORY,
    EformsignDocStepWriteOptions,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

import { TERMINAL_STATUS_CODES } from "./eformsign-doc-status.constants";

export interface UpdateEformsignDocStatusParams {
    documentId: string;
    statusType: string;
    statusDetail: string;
    stepType?: string;
    stepIndex?: string;
    stepName?: string;
    expired?: boolean;
    /**
     * The event reports an action (a document was opened), not a status. `statusType` is
     * then the mirror's own code, and the detail and expiry are not the event's to set:
     * a "서명 페이지 열림" or `expired: false` written over a terminal row would erase
     * "만료"/"거부" and un-expire it. Both are kept as stored.
     */
    actionOnly?: boolean;
    sourceUpdatedDate?: Date;
    documentName?: string;
    templateName?: string;
}

export interface UpdateEformsignDocStatusResult {
    document: EformsignDocEntity;
    applied: boolean;
}

@Injectable()
export class UpdateEformsignDocStatusUsecase {
    private readonly logger = new Logger(UpdateEformsignDocStatusUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(
        branchid: string,
        params: UpdateEformsignDocStatusParams
    ): Promise<EformsignDocEntity> {
        return (await this.executeWithOutcome(branchid, params)).document;
    }

    async executeWithOutcome(
        branchid: string,
        params: UpdateEformsignDocStatusParams,
    ): Promise<UpdateEformsignDocStatusResult> {
        const existing = await this.eformsignDocRepository.findByDocumentId(
            branchid,
            params.documentId
        );
        if (!existing) {
            throw new NotFoundException(`EformsignDoc with documentId ${params.documentId} not found`);
        }

        // P1-11 guard: once a document has reached a terminal status (completed,
        // or rejected/expired), never let a stale/out-of-order webhook downgrade
        // it back to a non-terminal status. Terminal -> terminal transitions
        // (e.g. completed -> rejected) remain allowed.
        if (TERMINAL_STATUS_CODES.has(normalizeEformsignStatusCode(existing.statusType)) && !TERMINAL_STATUS_CODES.has(params.statusType)) {
            this.logger.log(`ignoring stale downgrade ${params.statusType} for ${params.documentId}`);
            return { document: existing, applied: false };
        }

        if (
            params.sourceUpdatedDate
            && params.sourceUpdatedDate.getTime() <= existing.updatedDate.getTime()
            && params.statusType !== existing.statusType
        ) {
            this.logger.log(`ignoring stale timestamp ${params.statusType} for ${params.documentId}`);
            return { document: existing, applied: false };
        }

        // The entity refuses updatedDate < createdDate, and createdDate is the local write
        // time, which can be later than the vendor's updated_date. Clamp like the webhook
        // and unassigned-mirror paths do. The stale checks above ran against the original
        // source time; `existing.updatedDate >= existing.createdDate`, so a clamped value is
        // never newer than the stored row and the CAS below simply reports it as not applied.
        const updatedDate = params.sourceUpdatedDate
            ? new Date(Math.max(
                params.sourceUpdatedDate.getTime(),
                existing.createdDate.getTime(),
            ))
            : existing.updatedDate;

        // Reconstitute entity with updated fields
        const updated = EformsignDocEntity.reconstitute({
            id: existing.id,
            documentId: existing.documentId,
            documentName: params.documentName?.trim() || existing.documentName,
            documentNumber: existing.documentNumber,
            templateName: params.templateName?.trim() || existing.templateName,
            customerName: existing.customerName,
            creatorName: existing.creatorName,
            lastEditorName: existing.lastEditorName,
            stepRecipientTypes: existing.stepRecipientTypes,
            createdDate: existing.createdDate,
            updatedDate,
            statusType: params.statusType,
            statusDetail: params.actionOnly ? existing.statusDetail : params.statusDetail,
            stepType: params.stepType ?? existing.stepType,
            stepIndex: params.stepIndex ?? existing.stepIndex,
            stepName: params.stepName ?? existing.stepName,
            stepRecipientType: existing.stepRecipientType,
            stepRecipientName: existing.stepRecipientName,
            stepRecipientSms: existing.stepRecipientSms,
            expiredDate: existing.expiredDate,
            expired: params.actionOnly ? existing.expired : params.expired ?? existing.expired,
            clientId: existing.clientId,
            documentKind: existing.documentKind,
            employeeScheduleId: existing.employeeScheduleId,
            templateId: existing.templateId,
        });

        // Anything this usecase does not set is carried over from the row read above, so
        // writing it back could revert a newer value stored between that read and this
        // write. Tell the repository to leave those columns out of the UPDATE instead.
        // The recipient, document number and expiry are never an input here, so they are
        // always withheld; the step columns only when the caller did not supply them.
        const stepWriteOptions: EformsignDocStepWriteOptions = {
            ...(params.stepType === undefined ? { updateStepType: false } : {}),
            ...(params.stepIndex === undefined ? { updateStepIndex: false } : {}),
            ...(params.stepName === undefined ? { updateStepName: false } : {}),
            // The terminal fence above ran against `existing`, which another webhook may have
            // moved to a terminal status since; pin the UPDATE to the status that was read.
            ...(params.actionOnly
                ? {
                    updateStatusDetail: false,
                    updateExpired: false,
                    expectedStatusType: existing.statusType,
                }
                : {}),
            updateStepRecipient: false,
            updateDocumentNumber: false,
            updateExpiredDate: false,
            updateOwnershipIdentity: false,
        };

        if (params.sourceUpdatedDate) {
            return this.eformsignDocRepository.updateIfSourceNewer(branchid, updated, stepWriteOptions);
        }
        // No timestamp predicate here, but an `actionOnly` write is still pinned to the
        // status it read: report whether that UPDATE actually matched.
        return this.eformsignDocRepository.updateWithOutcome(branchid, updated, stepWriteOptions);
    }
}
