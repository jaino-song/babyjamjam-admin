import { SystemTemplateService } from "application/services/system-template.service";
import {
    GetAllSystemTemplatesUseCase,
    GetSystemTemplateUseCase,
    GetVersionContentUseCase,
    GetVersionHistoryUseCase,
    RenderTemplateUseCase,
    ResetToDefaultUseCase,
    RollbackToVersionUseCase,
    UpdateBranchSystemTemplateUseCase,
    UpdateSystemTemplateUseCase,
    ValidateTemplateContentUseCase,
} from "application/usecases/system-template";

describe("SystemTemplateService key boundary", () => {
    const createService = () => new SystemTemplateService(
        {} as GetAllSystemTemplatesUseCase,
        {} as GetSystemTemplateUseCase,
        {} as UpdateSystemTemplateUseCase,
        {} as UpdateBranchSystemTemplateUseCase,
        {} as ValidateTemplateContentUseCase,
        {} as RenderTemplateUseCase,
        {} as GetVersionHistoryUseCase,
        {} as GetVersionContentUseCase,
        {} as RollbackToVersionUseCase,
        {} as ResetToDefaultUseCase,
    );

    it("rejects an unregistered template key with the REQUEST_INVALID problem contract", async () => {
        const promise = createService().getByKey("not-a-registry-key");

        await expect(promise).rejects.toMatchObject({
            status: 400,
            response: expect.objectContaining({
                code: "REQUEST_INVALID",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
    });
});
