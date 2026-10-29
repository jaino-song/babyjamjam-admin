import { NotFoundException } from "@nestjs/common";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

describe("UpdateEformsignDocStatusUsecase", () => {
    const branchId = "test-branch";
    const documentId = "doc-123";

    const createDocEntity = (statusType: string): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            createdDate: new Date("2026-05-01T00:00:00.000Z"),
            updatedDate: new Date("2026-05-02T00:00:00.000Z"),
            statusType,
            statusDetail: "상태",
            stepType: "05",
            stepIndex: "3",
            stepName: "이용자",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-06-01T00:00:00.000Z"),
            expired: false,
            clientId: 9,
            documentName: "기존 문서명",
            templateName: "기존 템플릿명",
            customerName: "기존 고객명",
            creatorName: "기존 생성자",
            lastEditorName: "기존 편집자",
            stepRecipientTypes: ["05", "06"],
            templateId: "existing-template",
        });

    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
        updateWithOutcome: jest.fn(),
        updateIfSourceNewer: jest.fn(),
    };

    let usecase: UpdateEformsignDocStatusUsecase;

    beforeEach(() => {
        usecase = new UpdateEformsignDocStatusUsecase(eformsignDocRepository as never);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("throws NotFoundException when the document does not exist", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(null);

        await expect(
            usecase.execute(branchId, {
                documentId,
                statusType: "020",
                statusDetail: "서명 페이지 열림",
            }),
        ).rejects.toThrow(NotFoundException);
        expect(eformsignDocRepository.updateWithOutcome).not.toHaveBeenCalled();
    });

    it("ignores a stale downgrade from a completed (terminal) status to a non-terminal status", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("050"));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "020",
            statusDetail: "서명 페이지 열림",
        });

        expect(result.statusType).toBe("050");
        expect(eformsignDocRepository.updateWithOutcome).not.toHaveBeenCalled();
    });

    it("keeps the existing branch-owned 062 terminal guard unchanged", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("062"));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
        });

        expect(result.statusType).toBe("062");
        expect(eformsignDocRepository.updateWithOutcome).not.toHaveBeenCalled();
    });

    /**
     * 계약-04: 071 (the provider's reviewer rejected the document) is not terminal. A linked row
     * moves 070 -> 071 -> 070 (resubmitted) and 071 -> 072 (accepted); a truly terminal stored
     * status (080, 072, 042) still refuses a later non-terminal one, including 071 itself.
     */
    describe("071 (reviewer rejection) is not terminal", () => {
        const echo = (_branchid: string, doc: EformsignDocEntity) => Promise.resolve({ document: doc, applied: true });
        const newer = new Date("2026-05-03T00:00:00.000Z");

        beforeEach(() => {
            eformsignDocRepository.updateWithOutcome.mockImplementation(echo);
            eformsignDocRepository.updateIfSourceNewer.mockImplementation(echo);
        });

        it.each([
            ["070", "071", "검토 반려"],
            ["071", "070", "검토 요청"],
            ["071", "072", "검토 완료"],
        ])("applies stored %s -> %s", async (stored, incoming, statusDetail) => {
            eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity(stored));

            const result = await usecase.executeWithOutcome(branchId, {
                documentId,
                statusType: incoming,
                statusDetail,
                sourceUpdatedDate: newer,
            });

            expect(result.applied).toBe(true);
            expect(result.document.statusType).toBe(incoming);
            expect(result.document.statusDetail).toBe(statusDetail);
            expect(eformsignDocRepository.updateIfSourceNewer).toHaveBeenCalledTimes(1);
        });

        it.each([
            ["080", "070"],
            ["080", "071"],
            ["072", "071"],
            ["072", "070"],
            ["042", "070"],
        ])("still refuses a stored terminal %s -> non-terminal %s (never downgraded)", async (stored, incoming) => {
            eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity(stored));

            const result = await usecase.executeWithOutcome(branchId, {
                documentId,
                statusType: incoming,
                statusDetail: "검토",
                sourceUpdatedDate: newer,
            });

            expect(result.applied).toBe(false);
            expect(result.document.statusType).toBe(stored);
            expect(eformsignDocRepository.updateIfSourceNewer).not.toHaveBeenCalled();
            expect(eformsignDocRepository.updateWithOutcome).not.toHaveBeenCalled();
        });

        it("ignores a 070 event that is not newer than the stored 071", async () => {
            const existing = createDocEntity("071");
            eformsignDocRepository.findByDocumentId.mockResolvedValue(existing);

            const result = await usecase.executeWithOutcome(branchId, {
                documentId,
                statusType: "070",
                statusDetail: "검토 요청",
                sourceUpdatedDate: new Date(existing.updatedDate.getTime() - 1000),
            });

            expect(result.applied).toBe(false);
            expect(result.document.statusType).toBe("071");
            expect(eformsignDocRepository.updateIfSourceNewer).not.toHaveBeenCalled();
        });
    });

    it("allows a normal non-terminal -> non-terminal transition", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.updateWithOutcome.mockImplementation(
            (_branchid, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "020",
            statusDetail: "서명 페이지 열림",
        });

        expect(result.statusType).toBe("020");
        expect(eformsignDocRepository.updateWithOutcome).toHaveBeenCalledTimes(1);
    });

    it("allows a terminal -> terminal transition (e.g. completed -> rejected)", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("050"));
        eformsignDocRepository.updateWithOutcome.mockImplementation(
            (_branchid, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "080",
            statusDetail: "거부",
        });

        expect(result.statusType).toBe("080");
        expect(eformsignDocRepository.updateWithOutcome).toHaveBeenCalledTimes(1);
    });

    it("does not project an older webhook timestamp over a newer vendor mirror", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("071"));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "080",
            statusDetail: "만료",
            sourceUpdatedDate: new Date("2026-05-01T00:00:00.000Z"),
        });

        expect(result.statusType).toBe("071");
        expect(eformsignDocRepository.updateWithOutcome).not.toHaveBeenCalled();
    });

    it("keeps the authoritative mirror status when a conflicting webhook has the same timestamp", async () => {
        const existing = createDocEntity("071");
        eformsignDocRepository.findByDocumentId.mockResolvedValue(existing);

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "080",
            statusDetail: "만료",
            sourceUpdatedDate: existing.updatedDate,
        });

        expect(result.statusType).toBe("071");
        expect(eformsignDocRepository.updateWithOutcome).not.toHaveBeenCalled();
    });

    it("clamps a vendor timestamp that precedes the row's createdDate instead of throwing", async () => {
        // The row's createdDate is the local write time, which can be later than the vendor's
        // updated_date; the entity refuses updatedDate < createdDate, which used to fail every
        // same-status (060 -> 060) doc_request_participant webhook.
        const existing = createDocEntity("060");
        const sourceUpdatedDate = new Date(existing.createdDate.getTime() - 60_000);
        eformsignDocRepository.findByDocumentId.mockResolvedValue(existing);
        eformsignDocRepository.updateIfSourceNewer.mockImplementation(
            (_branchId, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        await expect(usecase.executeWithOutcome(branchId, {
            documentId,
            statusType: "060",
            statusDetail: "서명 대기",
            sourceUpdatedDate,
        })).resolves.toEqual(expect.objectContaining({ applied: true }));

        const persisted = eformsignDocRepository.updateIfSourceNewer.mock.calls[0]![1] as EformsignDocEntity;
        expect(persisted.updatedDate).toEqual(existing.createdDate);
    });

    it("stores the vendor timestamp and enables the repository CAS for a current webhook", async () => {
        const sourceUpdatedDate = new Date("2026-05-03T00:00:00.000Z");
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.updateIfSourceNewer.mockImplementation(
            (_branchId, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            sourceUpdatedDate,
        });

        expect(eformsignDocRepository.updateIfSourceNewer).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ updatedDate: sourceUpdatedDate }),
            // This call supplied no step fields, so the repository must not write the
            // values read earlier back over a newer step. The recipient, document number
            // and expiry are never an input, so they are always withheld.
            {
                updateStepType: false,
                updateStepIndex: false,
                updateStepName: false,
                updateStepRecipient: false,
                updateDocumentNumber: false,
                updateExpiredDate: false,
                updateOwnershipIdentity: false,
            },
        );
    });

    it.each([undefined, new Date("2026-05-03T00:00:00.000Z")])(
        "withholds ownership/identity on an actionOnly write (timestamp=%s)", async (sourceUpdatedDate) => {
            eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
            await usecase.execute(branchId, {
                documentId, statusType: "060", statusDetail: "서명 페이지 열림",
                actionOnly: true, sourceUpdatedDate,
            });
            const writer = sourceUpdatedDate
                ? eformsignDocRepository.updateIfSourceNewer
                : eformsignDocRepository.updateWithOutcome;
            expect(writer).toHaveBeenCalledWith(branchId, expect.any(EformsignDocEntity), expect.objectContaining({
                updateOwnershipIdentity: false, expectedStatusType: "060",
            }));
        },
    );

    it("writes the step fields the caller supplies and withholds only the ones it never sets", async () => {
        const sourceUpdatedDate = new Date("2026-05-03T00:00:00.000Z");
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.updateIfSourceNewer.mockImplementation(
            (_branchId, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            stepType: "06",
            stepIndex: "3",
            sourceUpdatedDate,
        });

        expect(eformsignDocRepository.updateIfSourceNewer).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ stepType: "06", stepIndex: "3" }),
            {
                updateStepName: false,
                updateStepRecipient: false,
                updateDocumentNumber: false,
                updateExpiredDate: false,
                updateOwnershipIdentity: false,
            },
        );
    });

    it("stores webhook documentName without replacing the locally selected templateId", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.updateWithOutcome.mockImplementation(
            (_branchid, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            documentName: "새 문서명",
        });

        expect(result.documentName).toBe("새 문서명");
        expect(result.templateId).toBe("existing-template");
    });

    it("keeps existing documentName when the webhook value is empty", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.updateWithOutcome.mockImplementation(
            (_branchid, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            documentName: "   ",
        });

        expect(result.documentName).toBe("기존 문서명");
        expect(result.templateId).toBe("existing-template");
    });

    it("updates templateName while preserving the other list display fields", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.updateWithOutcome.mockImplementation(
            (_branchid, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            templateName: "새 템플릿명",
        });

        expect(result.templateName).toBe("새 템플릿명");
        expect(result.customerName).toBe("기존 고객명");
        expect(result.creatorName).toBe("기존 생성자");
        expect(result.lastEditorName).toBe("기존 편집자");
        expect(result.stepRecipientTypes).toEqual(["05", "06"]);
    });

    it("keeps the existing templateName when the webhook value is empty", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.updateWithOutcome.mockImplementation(
            (_branchid, doc) => Promise.resolve({ document: doc, applied: true }),
        );

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            templateName: "   ",
        });

        expect(result.templateName).toBe("기존 템플릿명");
    });

    describe("outcome of the unguarded (no source timestamp) write", () => {
        it("reports applied:false when the pinned UPDATE matched no row", async () => {
            const moved = createDocEntity("080");
            eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
            eformsignDocRepository.updateWithOutcome.mockResolvedValue({ document: moved, applied: false });

            const result = await usecase.executeWithOutcome(branchId, {
                documentId,
                statusType: "060",
                statusDetail: "서명 페이지 열림",
                actionOnly: true,
            });

            expect(result.applied).toBe(false);
            expect(result.document.statusType).toBe("080");
            expect(eformsignDocRepository.updateWithOutcome).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "060" }),
                expect.objectContaining({ expectedStatusType: "060" }),
            );
        });

        it("reports applied:true when the pinned UPDATE matched", async () => {
            eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
            eformsignDocRepository.updateWithOutcome.mockImplementation(
                (_branchId, doc) => Promise.resolve({ document: doc, applied: true }),
            );

            const result = await usecase.executeWithOutcome(branchId, {
                documentId,
                statusType: "060",
                statusDetail: "서명 페이지 열림",
                actionOnly: true,
            });

            expect(result.applied).toBe(true);
            expect(result.document.statusType).toBe("060");
        });
    });
});
