import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";

describe("DispatchDocumentHeadlessUsecase", () => {
    it("persists the current eformsign status after headless creation", async () => {
        const eformsignService = {
            generateDocumentOptions: jest.fn().mockReturnValue({ mode: { type: "01" } }),
        };
        const headlessService = {
            dispatchCreation: jest.fn().mockResolvedValue({
                ok: true,
                documentId: "doc-1",
                durationMs: 1200,
            }),
        };
        const areaTemplateService = {
            findByArea: jest.fn().mockResolvedValue(null),
        };
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: "access-token",
                    refresh_token: "refresh-token",
                },
            }),
        };
        const createEformsignDocUsecase = {
            execute: jest.fn().mockResolvedValue(undefined),
        };
        const fetchEformsignDocFromApiUsecase = {
            execute: jest.fn().mockResolvedValue({
                template: {
                    id: "template-1",
                    name: "서구 계약서 (검토 단계)",
                },
                current_status: {
                    status_type: "003",
                    step_type: "01",
                    step_index: "4",
                    step_name: "완료",
                    expired_date: 0,
                    _expired: false,
                },
            }),
        };
        const progressService = {
            emit: jest.fn(),
        };
        const clientRepository = {
            findById: jest.fn().mockResolvedValue({
                name: "김고객",
                phone: "010-1234-5678",
            }),
        };

        const usecase = new DispatchDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            areaTemplateService as never,
            getAccessTokenUsecase as never,
            createEformsignDocUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            progressService as never,
            clientRepository as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            progressId: "progress-1",
            contractData: {
                customerName: "김고객",
                customerContact: "010-1234-5678",
            } as never,
        })).resolves.toEqual({
            ok: true,
            documentId: "doc-1",
            durationMs: 1200,
        });

        expect(createEformsignDocUsecase.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                documentId: "doc-1",
                clientId: 7,
                statusType: "003",
                statusDetail: "완료",
                stepType: "01",
                stepIndex: "4",
                stepName: "완료",
            }),
        );
    });

    it("falls back to the initial sign-request status when eformsign status fetch fails", async () => {
        const eformsignService = {
            generateDocumentOptions: jest.fn().mockReturnValue({ mode: { type: "01" } }),
        };
        const headlessService = {
            dispatchCreation: jest.fn().mockResolvedValue({
                ok: true,
                documentId: "doc-2",
                durationMs: 900,
            }),
        };
        const areaTemplateService = {
            findByArea: jest.fn().mockResolvedValue(null),
        };
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: "access-token",
                    refresh_token: "refresh-token",
                },
            }),
        };
        const createEformsignDocUsecase = {
            execute: jest.fn().mockResolvedValue(undefined),
        };
        const fetchEformsignDocFromApiUsecase = {
            execute: jest.fn().mockRejectedValue(new Error("document not found")),
        };
        const progressService = {
            emit: jest.fn(),
        };
        const clientRepository = {
            findById: jest.fn().mockResolvedValue(null),
        };

        const usecase = new DispatchDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            areaTemplateService as never,
            getAccessTokenUsecase as never,
            createEformsignDocUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            progressService as never,
            clientRepository as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 8,
            contractData: {
                customerName: "이고객",
                customerContact: "010-0000-0000",
            } as never,
        })).resolves.toEqual({
            ok: true,
            documentId: "doc-2",
            durationMs: 900,
        });

        expect(createEformsignDocUsecase.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                documentId: "doc-2",
                clientId: 8,
                statusType: "060",
                statusDetail: "서명 요청됨",
                stepType: "01",
                stepIndex: "1",
                stepName: "서명 요청",
            }),
        );
    });
});
