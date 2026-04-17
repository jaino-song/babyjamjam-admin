import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { ListDailyRecordEntriesUsecase } from "./list-daily-record-entries.usecase";

export interface FinalizeServiceRecordParams {
    eformsignDocId: number;
    force: boolean;
}

export interface FinalizeServiceRecordResult {
    doc: EformsignDocEntity;
    missingDates: string[]; // empty if all entries filled
    forced: boolean;
}

/**
 * Phase 2 completion.
 * Flips statusType from "070" (collecting) to "050" (completed), sets finalizedAt.
 * Does NOT re-run LinkDocumentToClientUsecase (already ran at Phase 1).
 * Does NOT re-send the contract-signed alimtalk (already sent at Phase 1).
 * No new alimtalk at Phase 2 (intentional — see PRD v0.2.0).
 *
 * If force=false and there are missing dates, throws BadRequestException with the list.
 * If force=true, proceeds even with gaps and returns them in the result for the caller to surface.
 */
@Injectable()
export class FinalizeServiceRecordUsecase {
    private readonly logger = new Logger(FinalizeServiceRecordUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        private readonly listEntriesUsecase: ListDailyRecordEntriesUsecase,
    ) {}

    async execute(
        organizationid: string,
        params: FinalizeServiceRecordParams,
    ): Promise<FinalizeServiceRecordResult> {
        const doc = await this.eformsignDocRepository.findById(organizationid, params.eformsignDocId);
        if (!doc) {
            throw new NotFoundException(
                `EformsignDoc with id ${params.eformsignDocId} not found`,
            );
        }

        if (doc.statusType !== "070") {
            throw new BadRequestException(
                `Cannot finalize: document status is ${doc.statusType}, expected 070 (collecting)`,
            );
        }

        const { missingDates } = await this.listEntriesUsecase.execute(
            organizationid,
            params.eformsignDocId,
        );

        if (missingDates.length > 0 && !params.force) {
            throw new BadRequestException({
                message: "Daily records are incomplete. Use force=true to finalize anyway.",
                missingDates,
            });
        }

        const updated = EformsignDocEntity.reconstitute({
            id: doc.id,
            documentId: doc.documentId,
            createdDate: doc.createdDate,
            updatedDate: new Date(),
            statusType: "050",
            statusDetail: "완료",
            stepType: doc.stepType,
            stepIndex: doc.stepIndex,
            stepName: doc.stepName,
            stepRecipientType: doc.stepRecipientType,
            stepRecipientName: doc.stepRecipientName,
            stepRecipientSms: doc.stepRecipientSms,
            expiredDate: doc.expiredDate,
            expired: doc.expired,
            clientId: doc.clientId,
            collectionStartDate: doc.collectionStartDate,
            collectionEndDate: doc.collectionEndDate,
            collectionPeriodDays: doc.collectionPeriodDays,
            finalizedAt: new Date(),
            forceFinalize: params.force && missingDates.length > 0,
        });

        const saved = await this.eformsignDocRepository.update(organizationid, updated);

        this.logger.log(
            `Finalized service record doc ${doc.documentId} (id=${doc.id}): force=${params.force}, missing=${missingDates.length}`,
        );

        return {
            doc: saved,
            missingDates,
            forced: params.force && missingDates.length > 0,
        };
    }
}
