import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

export interface StartDailyRecordCollectionParams {
    documentId: string;
    collectionPeriodDays?: number;
    startDate?: Date;
}

const DEFAULT_COLLECTION_PERIOD_DAYS = 30;

/**
 * Phase 1 → Phase 2 transition helper.
 * Initializes the collection window on an eformsign_doc after it enters status "070".
 * Does NOT change the status itself — that happens in UpdateEformsignDocStatusUsecase
 * as part of the webhook branching. This usecase only sets the collection metadata.
 */
@Injectable()
export class StartDailyRecordCollectionUsecase {
    private readonly logger = new Logger(StartDailyRecordCollectionUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(
        organizationid: string,
        params: StartDailyRecordCollectionParams,
    ): Promise<EformsignDocEntity> {
        const existing = await this.eformsignDocRepository.findByDocumentId(
            organizationid,
            params.documentId,
        );
        if (!existing) {
            throw new NotFoundException(
                `EformsignDoc with documentId ${params.documentId} not found`,
            );
        }

        const periodDays = params.collectionPeriodDays ?? DEFAULT_COLLECTION_PERIOD_DAYS;
        const startDate = params.startDate ?? new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + periodDays);

        const updated = EformsignDocEntity.reconstitute({
            id: existing.id,
            documentId: existing.documentId,
            createdDate: existing.createdDate,
            updatedDate: new Date(),
            statusType: existing.statusType,
            statusDetail: existing.statusDetail,
            stepType: existing.stepType,
            stepIndex: existing.stepIndex,
            stepName: existing.stepName,
            stepRecipientType: existing.stepRecipientType,
            stepRecipientName: existing.stepRecipientName,
            stepRecipientSms: existing.stepRecipientSms,
            expiredDate: existing.expiredDate,
            expired: existing.expired,
            clientId: existing.clientId,
            collectionStartDate: startDate,
            collectionEndDate: endDate,
            collectionPeriodDays: periodDays,
            finalizedAt: existing.finalizedAt,
            forceFinalize: existing.forceFinalize,
        });

        const saved = await this.eformsignDocRepository.update(organizationid, updated);
        this.logger.log(
            `Started daily record collection for ${params.documentId}: ${periodDays} days, ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`,
        );
        return saved;
    }
}
