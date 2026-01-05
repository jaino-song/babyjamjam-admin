import { Inject, Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

export interface CreateEformsignDocParams {
    documentId: string;
    clientId: number;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    stepRecipientType: string;
    stepRecipientName: string;
    stepRecipientSms: string;
    expiredDate: Date;
}

@Injectable()
export class CreateEformsignDocUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(params: CreateEformsignDocParams): Promise<EformsignDocEntity> {
        const now = new Date();
        const entity = EformsignDocEntity.create({
            documentId: params.documentId,
            clientId: params.clientId,
            createdDate: now,
            statusType: params.statusType,
            statusDetail: params.statusDetail,
            stepType: params.stepType,
            stepIndex: params.stepIndex,
            stepName: params.stepName,
            stepRecipientType: params.stepRecipientType,
            stepRecipientName: params.stepRecipientName,
            stepRecipientSms: params.stepRecipientSms,
            expiredDate: params.expiredDate,
            expired: false,
        });
        return this.eformsignDocRepository.create(entity);
    }
}
