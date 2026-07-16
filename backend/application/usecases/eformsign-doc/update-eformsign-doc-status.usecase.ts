import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

export interface UpdateEformsignDocStatusParams {
    documentId: string;
    statusType: string;
    statusDetail: string;
    stepType?: string;
    stepIndex?: string;
    stepName?: string;
    expired?: boolean;
}

/**
 * Terminal eformsign document status codes (completed + rejected/expired series).
 * Mirrors the identical sets already defined in
 * application/services/eformsign-webhook.service.ts,
 * application/services/eformsign-doc.service.ts, and
 * application/usecases/eformsign-doc/dispatch-document-headless.usecase.ts.
 * No shared exported constant exists for these today, and those files are out
 * of scope for this change (P1-11), so the values are mirrored here rather
 * than introducing new/different status codes.
 */
const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"]);
const TERMINAL_STATUS_CODES = new Set([...COMPLETED_STATUS_CODES, ...REJECTED_STATUS_CODES]);

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
        if (TERMINAL_STATUS_CODES.has(existing.statusType) && !TERMINAL_STATUS_CODES.has(params.statusType)) {
            this.logger.log(`ignoring stale downgrade ${params.statusType} for ${params.documentId}`);
            return existing;
        }

        // Reconstitute entity with updated fields
        const updated = EformsignDocEntity.reconstitute({
            id: existing.id,
            documentId: existing.documentId,
            createdDate: existing.createdDate,
            updatedDate: new Date(),
            statusType: params.statusType,
            statusDetail: params.statusDetail,
            stepType: params.stepType ?? existing.stepType,
            stepIndex: params.stepIndex ?? existing.stepIndex,
            stepName: params.stepName ?? existing.stepName,
            stepRecipientType: existing.stepRecipientType,
            stepRecipientName: existing.stepRecipientName,
            stepRecipientSms: existing.stepRecipientSms,
            expiredDate: existing.expiredDate,
            expired: params.expired ?? existing.expired,
            clientId: existing.clientId,
            documentKind: existing.documentKind,
            employeeScheduleId: existing.employeeScheduleId,
            templateId: existing.templateId,
        });

        return this.eformsignDocRepository.update(branchid, updated);
    }
}
