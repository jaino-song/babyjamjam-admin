import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";

describe("FinalizeDocumentHeadlessUsecase", () => {
    it("finalizes a service record without requiring an end-date prefill", async () => {
        const eformsignService = {
            generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
        };
        const headlessService = {
            dispatchFinalize: jest.fn().mockResolvedValue({
                ok: true,
                durationMs: 640,
            }),
        };
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: "access-token",
                    refresh_token: "refresh-token",
                },
            }),
        };
        const progressService = {
            emit: jest.fn(),
        };

        const usecase = new FinalizeDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            getAccessTokenUsecase as never,
            progressService as never,
        );

        await expect(usecase.execute({
            documentId: "service-record-1",
            progressId: "progress-1",
        })).resolves.toEqual({
            ok: true,
            durationMs: 640,
        });

        expect(eformsignService.generateStaffCompletionOptions).toHaveBeenCalledWith(
            "service-record-1",
            "access-token",
            "refresh-token",
            undefined,
        );
        expect(headlessService.dispatchFinalize).toHaveBeenCalledWith({
            documentOption: { mode: { type: "02" } },
            documentId: "service-record-1",
            onProgress: expect.any(Function),
        });
    });
});
