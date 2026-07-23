import {
    CONTRACT_STATUS,
    UpdateClientContractStatusUsecase,
} from "application/usecases/eformsign-doc/update-client-contract-status.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

describe("UpdateClientContractStatusUsecase", () => {
    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
    };
    const clientRepository = {
        findById: jest.fn(),
        update: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("keeps an orphaned completed document without trying to update a deleted client", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(
            EformsignDocEntity.reconstitute({
                id: 1,
                documentId: "doc-orphan",
                createdDate: new Date("2026-07-01T00:00:00.000Z"),
                updatedDate: new Date("2026-07-02T00:00:00.000Z"),
                statusType: "050",
                statusDetail: "완료",
                stepType: "05",
                stepIndex: "1",
                stepName: "이용자",
                stepRecipientType: "05",
                stepRecipientName: "보존된 고객명",
                stepRecipientSms: "01012345678",
                expiredDate: new Date("2026-08-01T00:00:00.000Z"),
                expired: false,
                clientId: null,
                documentKind: "contract",
            }),
        );
        const usecase = new UpdateClientContractStatusUsecase(
            eformsignDocRepository as never,
            clientRepository as never,
        );

        await expect(
            usecase.execute("branch-1", "doc-orphan", CONTRACT_STATUS.COMPLETED, true),
        ).resolves.toBeUndefined();

        expect(clientRepository.findById).not.toHaveBeenCalled();
        expect(clientRepository.update).not.toHaveBeenCalled();
    });
});
