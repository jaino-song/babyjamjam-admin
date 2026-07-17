import { ConfigService } from "@nestjs/config";
import { AreaTemplateService } from "application/services/area-template.service";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";

describe("AreaTemplateService", () => {
    const configuredTemplateIds = {
        EFORMSIGN_NAMDONG_TEMPLATE_ID: "namdong-template-id",
        EFORMSIGN_SEOGU_TEMPLATE_ID: "seogu-template-id",
    };
    const listAreaTemplatesUsecase = { execute: jest.fn() };
    const createAreaTemplateUsecase = { execute: jest.fn() };
    const findAreaTemplateByAreaUsecase = { execute: jest.fn() };
    const updateAreaTemplateUsecase = { execute: jest.fn() };
    const deleteAreaTemplateUsecase = { execute: jest.fn() };
    const configService = {
        getOrThrow: jest.fn((key: keyof typeof configuredTemplateIds) => configuredTemplateIds[key]),
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

    it("returns the two configured legacy contract templates when no mappings exist", async () => {
        listAreaTemplatesUsecase.execute.mockResolvedValue([]);

        await expect(service.findAll()).resolves.toEqual([
            expect.objectContaining({
                id: "Namdonggu",
                areaId: "Namdonggu",
                templateId: configuredTemplateIds.EFORMSIGN_NAMDONG_TEMPLATE_ID,
                templateName: "인천 아이미래로 남동구 계약서",
            }),
            expect.objectContaining({
                id: "Seogu",
                areaId: "Seogu",
                templateId: configuredTemplateIds.EFORMSIGN_SEOGU_TEMPLATE_ID,
                templateName: "인천 아이미래로 서구 계약서",
            }),
        ]);
    });

    it.each([
        ["Namdonggu", configuredTemplateIds.EFORMSIGN_NAMDONG_TEMPLATE_ID],
        ["Seogu", configuredTemplateIds.EFORMSIGN_SEOGU_TEMPLATE_ID],
    ])("resolves the configured %s selection for document generation", async (areaId, templateId) => {
        findAreaTemplateByAreaUsecase.execute.mockResolvedValue(null);

        await expect(service.findByArea(areaId)).resolves.toEqual(
            expect.objectContaining({
                areaId,
                templateId,
            }),
        );
    });
});
