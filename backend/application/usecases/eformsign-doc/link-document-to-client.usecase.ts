import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

@Injectable()
export class LinkDocumentToClientUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(documentId: string): Promise<void> {
        const doc = await this.eformsignDocRepository.findByDocumentId(documentId);
        if (!doc) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }

        const client = await this.clientRepository.findById(doc.clientId);
        if (!client) {
            throw new NotFoundException(`Client ${doc.clientId} not found`);
        }

        // Update client's e_doc_id to link the signed document
        client.update({ eDocId: documentId });
        await this.clientRepository.update(client);
    }
}
