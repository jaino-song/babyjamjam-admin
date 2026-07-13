import { CreateEformsignDocParams, CreateEformsignDocUsecase } from "application/usecases/eformsign-doc/create-eformsign-doc.usecase";
import { ClientEntity } from "domain/entities/client.entity";
import { EFORMSIGN_DOCUMENT_KIND, EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

describe("CreateEformsignDocUsecase", () => {
    const branchId = "branch-1";
    const documentId = "doc-1";

    const createClient = (id: number, phone: string | null): ClientEntity =>
        ClientEntity.reconstitute(
            id,
            `고객 ${id}`,
            null,
            phone,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            true,
            null,
            null,
            null,
            false,
            null,
        );

    const createParams = (overrides: Partial<CreateEformsignDocParams> = {}): CreateEformsignDocParams => ({
        documentId,
        clientId: 7,
        statusType: "060",
        statusDetail: "대기",
        stepType: "01",
        stepIndex: "1",
        stepName: "서명 요청",
        stepRecipientType: "01",
        stepRecipientName: "고객",
        stepRecipientSms: "010-1234-5678",
        expiredDate: new Date("2026-06-01T00:00:00.000Z"),
        linkToClient: true,
        ...overrides,
    });

    const eformsignDocRepository = {
        create: jest.fn(async (_branchId: string, doc: EformsignDocEntity) => doc),
    };
    const clientRepository = {
        findById: jest.fn(),
        findByPhone: jest.fn(),
        update: jest.fn(),
    };

    let usecase: CreateEformsignDocUsecase;

    beforeEach(() => {
        jest.clearAllMocks();
        usecase = new CreateEformsignDocUsecase(
            eformsignDocRepository as never,
            clientRepository as never,
        );
    });

    it("links the explicit client when recipient phone matches that client", async () => {
        const client = createClient(7, "010-1234-5678");
        clientRepository.findById.mockResolvedValue(client);
        clientRepository.findByPhone.mockResolvedValue(client);

        const result = await usecase.execute(branchId, createParams());

        expect(result.clientId).toBe(7);
        expect(result.documentKind).toBe(EFORMSIGN_DOCUMENT_KIND.CONTRACT);
        expect(eformsignDocRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ clientId: 7, documentId }),
        );
        expect(client.eDocId).toBe(documentId);
        expect(clientRepository.update).toHaveBeenCalledWith(branchId, client);
    });

    it("uses the client matched by recipient phone when the supplied client id is not the phone owner", async () => {
        const suppliedClient = createClient(7, "010-0000-0000");
        const phoneMatchedClient = createClient(12, "01012345678");
        clientRepository.findById.mockResolvedValue(suppliedClient);
        clientRepository.findByPhone.mockResolvedValue(phoneMatchedClient);

        const result = await usecase.execute(branchId, createParams());

        expect(result.clientId).toBe(12);
        expect(eformsignDocRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ clientId: 12, documentId }),
        );
        expect(phoneMatchedClient.eDocId).toBe(documentId);
        expect(clientRepository.update).toHaveBeenCalledWith(branchId, phoneMatchedClient);
    });

    it("falls back to the supplied client when recipient phone has no client match", async () => {
        const client = createClient(7, "010-0000-0000");
        clientRepository.findById.mockResolvedValue(client);
        clientRepository.findByPhone.mockResolvedValue(null);

        const result = await usecase.execute(branchId, createParams());

        expect(result.clientId).toBe(7);
        expect(clientRepository.update).toHaveBeenCalledWith(branchId, client);
    });

    it("stores service feedback snapshot linkage without updating the client contract pointer", async () => {
        const result = await usecase.execute(branchId, createParams({
            documentId: "feedback-doc-1",
            linkToClient: false,
            documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_FEEDBACK_SNAPSHOT,
            employeeScheduleId: 33,
            templateId: "feedback-template-1",
        }));

        expect(result.documentKind).toBe(EFORMSIGN_DOCUMENT_KIND.SERVICE_FEEDBACK_SNAPSHOT);
        expect(result.employeeScheduleId).toBe(33);
        expect(result.templateId).toBe("feedback-template-1");
        expect(clientRepository.update).not.toHaveBeenCalled();
    });
});
