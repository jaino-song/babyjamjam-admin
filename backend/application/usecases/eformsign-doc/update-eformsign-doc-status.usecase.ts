import { Inject, Injectable, NotFoundException } from "@nestjs/common";
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

@Injectable()
export class UpdateEformsignDocStatusUsecase {
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
