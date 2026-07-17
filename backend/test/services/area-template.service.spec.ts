import { ConfigService } from "@nestjs/config";
import { AreaTemplateService } from "application/services/area-template.service";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";

describe("AreaTemplateService", () => {
    const configuredTemplateId = "configured-template-id";
    const listAreaTemplatesUsecase = { execute: jest.fn() };
    const createAreaTemplateUsecase = { execute: jest.fn() };
    const findAreaTemplateByAreaUsecase = { execute: jest.fn() };
    const updateAreaTemplateUsecase = { execute: jest.fn() };
    const deleteAreaTemplateUsecase = { execute: jest.fn() };
    const configService = {
        getOrThrow: jest.fn().mockReturnValue(configuredTemplateId),
    };

    const service = new AreaTemplateService(
        listAreaTemplatesUsecase as never,
        createAreaTemplateUsecase as never,
        findAreaTemplateByAreaUsecase as never,
        updateAreaTemplateUsecase as never,
        deleteAreaTemplateUsecase as never,
        configService as unknown as ConfigService,
    );

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns persisted templates when they exist", async () => {
        const persisted = AreaTemplateEntity.reconstitute("1", "Namdonggu", "area-template-id", "남동구 계약서");
        listAreaTemplatesUsecase.execute.mockResolvedValue([persisted]);

        await expect(service.findAll()).resolves.toEqual([persisted]);
        expect(configService.getOrThrow).not.toHaveBeenCalled();
    });

    it("returns the configured default template when no mappings exist", async () => {
        listAreaTemplatesUsecase.execute.mockResolvedValue([]);

        await expect(service.findAll()).resolves.toEqual([
            expect.objectContaining({
                id: "default",
                areaId: "default",
                templateId: configuredTemplateId,
                templateName: "인천 아이미래로 전자계약서",
            }),
        ]);
    });

    it("resolves the configured default selection for document generation", async () => {
        findAreaTemplateByAreaUsecase.execute.mockResolvedValue(null);

        await expect(service.findByArea("default")).resolves.toEqual(
            expect.objectContaining({
                areaId: "default",
                templateId: configuredTemplateId,
            }),
        );
    });
});
