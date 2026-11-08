import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";
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
    const createService = (all = {} as GetAllSystemTemplatesUseCase) => new SystemTemplateService(
        all,
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

    it("enriches global and branch reads with read-only group metadata and preserves stored content", async () => {
        const entities = [
            SystemTemplateEntity.create(SystemTemplateKey.GREETING, "frozen greeting"),
            SystemTemplateEntity.create(SystemTemplateKey.PROVIDER_NOTICE, ""),
        ];
        const service = createService({ execute: async () => entities, executeForBranch: async () => entities } as unknown as GetAllSystemTemplatesUseCase);
        for (const templates of [await service.getAll(), await service.getAllForBranch("branch-a")]) {
            expect(templates.map(({ templateKey, name, group, groupLabel, content }) => ({ templateKey, name, group, groupLabel, content }))).toEqual([
                { templateKey: "GREETING", name: "첫 인사", group: "mother", groupLabel: "산모 대상", content: "frozen greeting" },
                { templateKey: "PROVIDER_NOTICE", name: "제공인력 안내문", group: "provider", groupLabel: "제공인력 대상", content: "" },
            ]);
        }
    });

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
