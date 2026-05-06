import { Inject, Injectable } from "@nestjs/common";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { PendingStaffCompletionItemDto } from "interface/dto/staff-document.dto";

@Injectable()
export class ListPendingStaffCompletionUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchid: string): Promise<PendingStaffCompletionItemDto[]> {
        const docs = await this.eformsignDocRepository.findPendingStaffCompletion(branchid);
        const result: PendingStaffCompletionItemDto[] = [];

        for (const doc of docs) {
            const client = await this.clientRepository.findById(branchid, doc.clientId);
            result.push({
                documentId: doc.documentId,
                clientId: doc.clientId,
                clientName: client?.name ?? "(unknown)",
                signedAt: doc.updatedDate.toISOString(),
                statusDetail: doc.statusDetail,
            });
        }

        return result;
    }
}
