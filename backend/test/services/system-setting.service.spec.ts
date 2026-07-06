import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { SystemSettingEntity, AlimtalkProvider } from "domain/entities/system-setting.entity";

describe("SystemSettingService", () => {
    const createMockGetSettingUsecase = () => ({
        execute: jest.fn(),
        executeEntity: jest.fn(),
        executeWithDefault: jest.fn(),
    });

    const createMockUpdateSettingUsecase = () => ({
        execute: jest.fn(),
    });

    let service: SystemSettingService;
    let getSettingUsecase: ReturnType<typeof createMockGetSettingUsecase>;
    let updateSettingUsecase: ReturnType<typeof createMockUpdateSettingUsecase>;

    beforeEach(() => {
        getSettingUsecase = createMockGetSettingUsecase();
        updateSettingUsecase = createMockUpdateSettingUsecase();
        service = new SystemSettingService(
            getSettingUsecase as unknown as GetSettingUsecase,
            updateSettingUsecase as unknown as UpdateSettingUsecase
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("getAlimtalkProvider", () => {
        it("should return the current provider when set", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("aligo_alimtalk");

            const result = await service.getAlimtalkProvider();

            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledWith(
                "alimtalk_provider",
                "aligo_alimtalk"
            );
            expect(result).toBe("aligo_alimtalk");
        });

        it("should return default 'aligo_alimtalk' when not set", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("aligo_alimtalk");

            const result = await service.getAlimtalkProvider();

            expect(result).toBe("aligo_alimtalk");
        });

        it("should return 'none' when disabled", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("none");

            const result = await service.getAlimtalkProvider();

            expect(result).toBe("none");
        });
    });

    describe("getAlimtalkProviderSetting", () => {
        it("should return the stored provider setting entity with updatedAt", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo_alimtalk",
                new Date("2026-05-28T12:00:00.000Z")
            );
            getSettingUsecase.executeEntity.mockResolvedValue(entity);

            const result = await service.getAlimtalkProviderSetting();

            expect(getSettingUsecase.executeEntity).toHaveBeenCalledWith("alimtalk_provider");
            expect(result).toBe(entity);
        });
    });

    describe("setAlimtalkProvider", () => {
        it("should update the provider setting", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo_alimtalk",
                new Date()
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const result = await service.setAlimtalkProvider("aligo_alimtalk");

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "alimtalk_provider",
                "aligo_alimtalk"
            );
            expect(result.value).toBe("aligo_alimtalk");
        });

        it.each(["aligo_alimtalk", "none"] as AlimtalkProvider[])(
            "should accept valid provider '%s'",
            async (provider) => {
                const entity = new SystemSettingEntity(
                    "alimtalk_provider",
                    provider,
                    new Date()
                );
                updateSettingUsecase.execute.mockResolvedValue(entity);

                const result = await service.setAlimtalkProvider(provider);

                expect(result.value).toBe(provider);
            }
        );

        it("should throw error for invalid provider", async () => {
            await expect(
                service.setAlimtalkProvider("invalid" as AlimtalkProvider)
            ).rejects.toThrow("Invalid alimtalk provider");
        });
    });

    describe("isAlimtalkEnabled", () => {
        it("should return true when provider is aligo_alimtalk", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("aligo_alimtalk");

            const result = await service.isAlimtalkEnabled();

            expect(result).toBe(true);
        });

        it("should return false when provider is none", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("none");

            const result = await service.isAlimtalkEnabled();

            expect(result).toBe(false);
        });
    });
});
