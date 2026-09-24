import { FindRecentContractsUsecase } from "./find-recent-contracts.usecase";

function recentRow({
    documentId = "doc-1",
    documentName = "계약서",
    clientId = 10,
    clientName = "산모",
    statusType = "060",
    statusDetail = "대기",
    stepType = "06",
    stepName = "제공기관 확인",
    updatedDate = new Date("2026-09-20T00:00:00.000Z"),
    expired = false,
}: Partial<{
    documentId: string;
    documentName: string | null;
    clientId: number | null;
    clientName: string | null;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepName: string;
    updatedDate: Date;
    expired: boolean;
}> = {}) {
    return { documentId, documentName, clientId, clientName, statusType, statusDetail, stepType, stepName, updatedDate, expired };
}

describe("FindRecentContractsUsecase", () => {
    function setup() {
        const eformsignDocRepository = {
            findRecentContracts: jest.fn(),
            findContractEndDatesByDocumentIds: jest.fn(),
        };
        const usecase = new FindRecentContractsUsecase(eformsignDocRepository as never);
        return { eformsignDocRepository, usecase };
    }

    it("wires the mirrored contract end date onto each row, keyed by document id", async () => {
        const { eformsignDocRepository, usecase } = setup();
        eformsignDocRepository.findRecentContracts.mockResolvedValue([
            recentRow({ documentId: "doc-1" }),
            recentRow({ documentId: "doc-2" }),
        ]);
        eformsignDocRepository.findContractEndDatesByDocumentIds.mockResolvedValue(
            new Map([["doc-1", "2027-06-01"]]),
        );

        const rows = await usecase.execute("branch-a", 10);

        expect(eformsignDocRepository.findContractEndDatesByDocumentIds).toHaveBeenCalledWith(["doc-1", "doc-2"]);
        expect(rows).toEqual([
            expect.objectContaining({ documentId: "doc-1", contractEndDate: "2027-06-01" }),
            expect.objectContaining({ documentId: "doc-2", contractEndDate: null }),
        ]);
    });

    it("skips the end-date lookup entirely for an empty result", async () => {
        const { eformsignDocRepository, usecase } = setup();
        eformsignDocRepository.findRecentContracts.mockResolvedValue([]);

        const rows = await usecase.execute("branch-a", 10);

        expect(rows).toEqual([]);
        expect(eformsignDocRepository.findContractEndDatesByDocumentIds).not.toHaveBeenCalled();
    });
});
