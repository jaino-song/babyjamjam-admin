import type { Prisma } from "@prisma/client";
import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { UpdateSettingUsecase } from "application/usecases/system-setting/update-setting.usecase";
import { ISystemSettingRepository } from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("UpdateSettingUsecase", () => {
    const createMockRepository = (): jest.Mocked<ISystemSettingRepository> => ({
        findByKey: jest.fn(),
        upsert: jest.fn(),
        compareAndSet: jest.fn(),
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

    it("delegates compare-and-set updates with the supplied version function", async () => {
        const entity = new SystemSettingEntity("ribbon_config", "{}", new Date());
        repository.compareAndSet.mockResolvedValue(entity);
        const versionOf = (value: string | null) => value ?? "default";

        await expect(usecase.executeIfVersion("ribbon_config", "{}", "v1", versionOf)).resolves.toBe(entity);
        expect(repository.compareAndSet).toHaveBeenCalledWith(
            "ribbon_config",
            "v1",
            expect.objectContaining({ key: "ribbon_config", value: "{}" }),
            versionOf,
        );
    });
});

// These assertions exercise the actual use cases, rather than mocking forwarding.
describe("setting transaction propagation", () => {
    it("forwards the identical provided transaction for reads and CAS, preserving legacy arity", async () => {
        const tx = { marker: "branch-locked-transaction" } as unknown as Prisma.TransactionClient;
        const repository = { findByKey: jest.fn().mockResolvedValue(null), compareAndSet: jest.fn().mockResolvedValue(null) } as unknown as jest.Mocked<ISystemSettingRepository>;
        const get = new GetSettingUsecase(repository);
        const update = new UpdateSettingUsecase(repository);
        const versionOf = (value: string | null) => value ?? "absent";
        await get.execute("key", tx);
        await get.executeEntity("key", tx);
        expect(repository.findByKey.mock.calls).toEqual([["key", tx], ["key", tx]]);
        await get.execute("key");
        expect(repository.findByKey).toHaveBeenLastCalledWith("key");
        await update.executeIfVersion("key", "value", "absent", versionOf, undefined, tx);
        expect(repository.compareAndSet).toHaveBeenLastCalledWith("key", "absent", expect.any(SystemSettingEntity), versionOf, undefined, tx);
        await update.executeIfVersion("key", "value", "absent", versionOf);
        expect(repository.compareAndSet).toHaveBeenLastCalledWith("key", "absent", expect.any(SystemSettingEntity), versionOf);
    });
});
