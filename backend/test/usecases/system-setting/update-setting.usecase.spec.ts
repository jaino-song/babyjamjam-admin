import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { ISystemSettingRepository } from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("UpdateSettingUsecase", () => {
    const createMockRepository = (): jest.Mocked<ISystemSettingRepository> => ({
        findByKey: jest.fn(),
        upsert: jest.fn(),
    });

    let usecase: UpdateSettingUsecase;
    let repository: jest.Mocked<ISystemSettingRepository>;

    beforeEach(() => {
        repository = createMockRepository();
        usecase = new UpdateSettingUsecase(repository);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("execute", () => {
        it("should upsert the setting and return the entity", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo_alimtalk",
                new Date()
            );
            repository.upsert.mockResolvedValue(entity);

            const result = await usecase.execute("alimtalk_provider", "aligo_alimtalk");

            expect(repository.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    key: "alimtalk_provider",
                    value: "aligo_alimtalk",
                })
            );
            expect(result.key).toBe("alimtalk_provider");
            expect(result.value).toBe("aligo_alimtalk");
        });

        it("should work for different key-value pairs", async () => {
            const entity = new SystemSettingEntity("other_key", "other_value", new Date());
            repository.upsert.mockResolvedValue(entity);

            const result = await usecase.execute("other_key", "other_value");

            expect(result.key).toBe("other_key");
            expect(result.value).toBe("other_value");
        });
    });
});
