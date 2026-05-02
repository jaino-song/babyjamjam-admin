import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { ClientEntity } from "domain/entities/client.entity";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

describe("EformsignWebhookService", () => {
    const branchId = "test-branch";
    const documentId = "doc-123";

    const createDocEntity = (): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            createdDate: new Date("2026-05-01T00:00:00.000Z"),
            updatedDate: new Date("2026-05-02T00:00:00.000Z"),
            statusType: "060",
            statusDetail: "결재 요청됨",
            stepType: "06",
            stepIndex: "3",
            stepName: "확정",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-06-01T00:00:00.000Z"),
            expired: false,
            clientId: 9,
        });

    const createClientEntity = (): ClientEntity =>
        ClientEntity.reconstitute(
            9,
            "테스트 고객",
            "인천",
            "010-1234-5678",
            "A",
            15,
            "1000000",
            "700000",
            "300000",
            new Date("2026-05-01T00:00:00.000Z"),
            new Date("2026-05-20T00:00:00.000Z"),
            false,
            true,
            "900101",
            null,
            "waiting",
            false,
            documentId,
            new Date("2026-04-01T00:00:00.000Z"),
        );

    const createDocumentPayload = (): EformsignWebhookPayloadDto => ({
        webhook_id: "wh-1",
        webhook_name: "test",
        company_id: "company-1",
        event_type: "document",
        document: {
            id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            template_id: "template-1",
            template_name: "template",
            workflow_seq: 3,
            workflow_name: "직원 확정",
            status: "doc_complete",
            updated_date: Date.now(),
        },
    });

    const createReadyPdfPayload = (): EformsignWebhookPayloadDto => ({
        webhook_id: "wh-2",
        webhook_name: "test",
        company_id: "company-1",
        event_type: "ready_document_pdf",
        ready_document_pdf: {
            document_id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            workflow_seq: 3,
            workflow_name: "직원 확정",
            template_id: "template-1",
            template_name: "template",
            document_status: "doc_complete",
        },
    });

    const updateStatusUsecase = {
        execute: jest.fn(),
    };
    const linkDocumentUsecase = {
        execute: jest.fn(),
    };
    const syncClientEndDateUsecase = {
        execute: jest.fn(),
    };
    const alimtalkService = {
        sendContractSignedAlimtalk: jest.fn(),
    };
    const eformsignApiClient = {
        getAccessToken: jest.fn(),
    };
    const clientRepository = {
        findById: jest.fn(),
    };
    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
    };
    const employeeScheduleRepository = {
        findByClientId: jest.fn(),
    };
    const employeeRepository = {
        findById: jest.fn(),
    };

    let service: EformsignWebhookService;

    beforeEach(() => {
        service = new EformsignWebhookService(
            updateStatusUsecase as never,
            linkDocumentUsecase as never,
            syncClientEndDateUsecase as never,
            alimtalkService as never,
            eformsignApiClient as never,
            clientRepository as never,
            eformsignDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
        );

        updateStatusUsecase.execute.mockResolvedValue(createDocEntity());
        linkDocumentUsecase.execute.mockResolvedValue(undefined);
        syncClientEndDateUsecase.execute.mockResolvedValue(undefined);
        eformsignApiClient.getAccessToken.mockResolvedValue({
            oauth_token: {
                access_token: "test-access-token",
                refresh_token: "test-refresh-token",
            },
        });
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity());
        clientRepository.findById.mockResolvedValue(createClientEntity());
        employeeScheduleRepository.findByClientId.mockResolvedValue([]);
        employeeRepository.findById.mockResolvedValue(null);
        alimtalkService.sendContractSignedAlimtalk.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should call link and sync usecases for DOC_COMPLETE document events", async () => {
        await expect(service.processWebhook(branchId, createDocumentPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(branchId, documentId, "test-access-token");
    });

    it("should keep processing document events when sync throws", async () => {
        syncClientEndDateUsecase.execute.mockRejectedValue(new Error("sync failed"));

        await expect(service.processWebhook(branchId, createDocumentPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(branchId, documentId, "test-access-token");
        expect(alimtalkService.sendContractSignedAlimtalk).toHaveBeenCalledTimes(1);
    });

    it("should call link and sync usecases for DOC_COMPLETE ready_document_pdf events", async () => {
        await expect(service.processWebhook(branchId, createReadyPdfPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(branchId, documentId, "test-access-token");
    });

    it("should keep processing ready_document_pdf events when sync throws", async () => {
        syncClientEndDateUsecase.execute.mockRejectedValue(new Error("sync failed"));

        await expect(service.processWebhook(branchId, createReadyPdfPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(branchId, documentId, "test-access-token");
        expect(alimtalkService.sendContractSignedAlimtalk).toHaveBeenCalledTimes(1);
    });
});
