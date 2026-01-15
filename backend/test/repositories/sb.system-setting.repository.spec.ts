import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("SbSystemSettingRepository", () => {
    const createMockPrismaClient = () => ({
        findUnique: jest.fn(),
        upsert: jest.fn(),
    });

    const createSystemSettingRow = (overrides = {}) => ({
        key: "alimtalk_provider",
        value: "aligo",
        updated_at: new Date("2025-01-14T00:00:00Z"),
        ...overrides,
    });

    let systemSettingModel: ReturnType<typeof createMockPrismaClient>;
    let prisma: PrismaService;
    let repository: SbSystemSettingRepository;

    beforeEach(() => {
        systemSettingModel = createMockPrismaClient();
        prisma = { system_setting: systemSettingModel } as unknown as PrismaService;
        repository = new SbSystemSettingRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findByKey", () => {
        describe("given a setting exists", () => {
            it("should return the mapped SystemSettingEntity", async () => {
                const row = createSystemSettingRow();
                systemSettingModel.findUnique.mockResolvedValue(row);

                const result = await repository.findByKey("alimtalk_provider");

                expect(systemSettingModel.findUnique).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                });
                expect(result).toBeInstanceOf(SystemSettingEntity);
                expect(result?.key).toBe("alimtalk_provider");
                expect(result?.value).toBe("aligo");
            });
        });

        describe("given a setting does not exist", () => {
            it("should return null", async () => {
                systemSettingModel.findUnique.mockResolvedValue(null);

                const result = await repository.findByKey("nonexistent_key");

                expect(result).toBeNull();
            });
        });
    });

    describe("upsert", () => {
        describe("given a new setting", () => {
            it("should create and return the setting", async () => {
                const entity = SystemSettingEntity.create("alimtalk_provider", "channeltalk");
                const row = createSystemSettingRow({ value: "channeltalk" });
                systemSettingModel.upsert.mockResolvedValue(row);

                const result = await repository.upsert(entity);

                expect(systemSettingModel.upsert).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                    create: { key: "alimtalk_provider", value: "channeltalk" },
                    update: { value: "channeltalk" },
                });
                expect(result).toBeInstanceOf(SystemSettingEntity);
                expect(result.value).toBe("channeltalk");
            });
        });

        describe("given an existing setting", () => {
            it("should update and return the setting", async () => {
                const entity = new SystemSettingEntity(
                    "alimtalk_provider",
                    "none",
                    new Date()
                );
                const row = createSystemSettingRow({ value: "none" });
                systemSettingModel.upsert.mockResolvedValue(row);

                const result = await repository.upsert(entity);

                expect(result.value).toBe("none");
            });
        });
    });
});
