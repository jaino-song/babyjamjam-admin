import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { SystemSettingEntity, AlimtalkProvider } from "domain/entities/system-setting.entity";

describe("SystemSettingService", () => {
    const createMockGetSettingUsecase = () => ({
        execute: jest.fn(),
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
            getSettingUsecase.executeWithDefault.mockResolvedValue("channeltalk");

            const result = await service.getAlimtalkProvider();

            expect(getSettingUsecase.executeWithDefault).toHaveBeenCalledWith(
                "alimtalk_provider",
                "aligo"
            );
            expect(result).toBe("channeltalk");
        });

        it("should return default 'aligo' when not set", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("aligo");

            const result = await service.getAlimtalkProvider();

            expect(result).toBe("aligo");
        });

        it("should return 'none' when disabled", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("none");

            const result = await service.getAlimtalkProvider();

            expect(result).toBe("none");
        });
    });

    describe("setAlimtalkProvider", () => {
        it("should update the provider setting", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "channeltalk",
                new Date()
            );
            updateSettingUsecase.execute.mockResolvedValue(entity);

            const result = await service.setAlimtalkProvider("channeltalk");

            expect(updateSettingUsecase.execute).toHaveBeenCalledWith(
                "alimtalk_provider",
                "channeltalk"
            );
            expect(result.value).toBe("channeltalk");
        });

        it.each(["channeltalk", "aligo", "none"] as AlimtalkProvider[])(
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
        it("should return true when provider is channeltalk", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("channeltalk");

            const result = await service.isAlimtalkEnabled();

            expect(result).toBe(true);
        });

        it("should return true when provider is aligo", async () => {
            getSettingUsecase.executeWithDefault.mockResolvedValue("aligo");

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
