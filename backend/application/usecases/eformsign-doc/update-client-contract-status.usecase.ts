import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

/**
 * Contract status values for client entity
 * Maps eformsign document status to client-friendly status
 */
export const CONTRACT_STATUS = {
    PENDING: "pending",         // 대기 (initial state before document creation)
    IN_PROGRESS: "in_progress", // 진행 중 (document created, waiting for signature)
    COMPLETED: "completed",     // 완료 (document signed and complete)
    CANCELLED: "cancelled",     // 취소 (document rejected, declined, or revoked)
} as const;

export type ContractStatusType = (typeof CONTRACT_STATUS)[keyof typeof CONTRACT_STATUS];

@Injectable()
export class UpdateClientContractStatusUsecase {
    private readonly logger = new Logger(UpdateClientContractStatusUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    /**
     * Update the client's contractStatus based on the eformsign document status
     * @param documentId - The eformsign document ID
     * @param contractStatus - The new contract status for the client
     * @param updateEDocId - If true, also updates client.eDocId (for completed documents)
     */
    async execute(
        branchid: string,
        documentId: string,
        contractStatus: ContractStatusType,
        updateEDocId: boolean = false,
    ): Promise<void> {
        const doc = await this.eformsignDocRepository.findByDocumentId(branchid, documentId);
        if (!doc) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }

        const client = await this.clientRepository.findById(branchid, doc.clientId);
        if (!client) {
            throw new NotFoundException(`Client ${doc.clientId} not found`);
        }

        const updateData: { contractStatus: ContractStatusType; eDocId?: string } = {
            contractStatus,
        };

        // Only update eDocId when document is completed
        if (updateEDocId) {
            updateData.eDocId = documentId;
        }

        client.update(updateData);
        await this.clientRepository.update(branchid, client);

        this.logger.log(
            `Updated client ${doc.clientId} contractStatus to '${contractStatus}'` +
            (updateEDocId ? ` and linked eDocId='${documentId}'` : "")
        );
    }
}
