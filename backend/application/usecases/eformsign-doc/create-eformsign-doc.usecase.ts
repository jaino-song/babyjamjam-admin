import { Inject, Injectable, Logger } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

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
    linkToClient?: boolean; // If true, also update client.e_doc_id
}

@Injectable()
export class CreateEformsignDocUsecase {
    private readonly logger = new Logger(CreateEformsignDocUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
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
        const createdDoc = await this.eformsignDocRepository.create(entity);

        // If linkToClient is true, also update client.e_doc_id to track this document
        if (params.linkToClient) {
            try {
                const client = await this.clientRepository.findById(params.clientId);
                if (client) {
                    client.update({ eDocId: params.documentId });
                    await this.clientRepository.update(client);
                    this.logger.log(`Linked document ${params.documentId} to client ${params.clientId}`);
                } else {
                    this.logger.warn(`Client ${params.clientId} not found, skipping e_doc_id update`);
                }
            } catch (error) {
                // Log but don't fail the whole operation if client update fails
                this.logger.error(`Failed to link document to client: ${error}`);
            }
        }

        return createdDoc;
    }
}
