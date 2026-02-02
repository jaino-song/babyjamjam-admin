import { SbBankAccountInfoRepository } from "infrastructure/database/repositories/sb.bank-account-info.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

describe("SbBankAccountInfoRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaBankAccount = () => ({
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createBankAccountRow = (overrides = {}) => ({
        areaId: "Seoul",
        bankName: "K-Bank",
        accNum: "123-456-7890",
        ...overrides,
    });

    let bankAccountModel: ReturnType<typeof createMockPrismaBankAccount>;
    let prisma: PrismaService;
    let repository: SbBankAccountInfoRepository;

    beforeEach(() => {
        bankAccountModel = createMockPrismaBankAccount();
        prisma = { bank_account_info: bankAccountModel } as unknown as PrismaService;
        repository = new SbBankAccountInfoRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findByArea
    // ============================================
    describe("findByArea", () => {
        describe("given a bank account exists for the specified area", () => {
            it("should return the mapped BankAccountInfoEntity", async () => {
                // Arrange
                const row = createBankAccountRow();
                bankAccountModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findByArea("Seoul");

                // Assert
                expect(bankAccountModel.findUnique).toHaveBeenCalledWith({ where: { areaId: "Seoul" } });
                expect(result).toBeInstanceOf(BankAccountInfoEntity);
                expect(result).toMatchObject({
                    area: "Seoul",
                    bankName: "K-Bank",
                    accNum: "123-456-7890",
                });
            });
        });

        describe("given no bank account exists for the specified area", () => {
            it("should return null", async () => {
                // Arrange
                bankAccountModel.findUnique.mockResolvedValue(null);

                // Act
                const result = await repository.findByArea("Busan");

                // Assert
                expect(bankAccountModel.findUnique).toHaveBeenCalledWith({ where: { areaId: "Busan" } });
                expect(result).toBeNull();
            });
        });

        describe("given different area names", () => {
            it.each(["Seoul", "Incheon", "Busan", "Daegu", "Daejeon"])(
                "should query with area %s",
                async (area) => {
                    // Arrange
                    bankAccountModel.findUnique.mockResolvedValue(null);

                    // Act
                    await repository.findByArea(area);

                    // Assert
                    expect(bankAccountModel.findUnique).toHaveBeenCalledWith({ where: { areaId: area } });
                }
            );
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given a valid BankAccountInfoEntity", () => {
            it("should persist bank account and return created entity", async () => {
                // Arrange
                const entity = BankAccountInfoEntity.create("Incheon", "IBK", "987-654-3210");
                const createdRow = createBankAccountRow({
                    areaId: "Incheon",
                    bankName: "IBK",
                    accNum: "987-654-3210",
                });
                bankAccountModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(bankAccountModel.create).toHaveBeenCalledWith({
                    data: {
                        areaId: "Incheon",
                        bankName: "IBK",
                        accNum: "987-654-3210",
                    },
                });
                expect(result).toBeInstanceOf(BankAccountInfoEntity);
                expect(result).toMatchObject({
                    area: "Incheon",
                    bankName: "IBK",
                    accNum: "987-654-3210",
                });
            });
        });

        describe("given different bank names", () => {
            it.each([
                ["K-Bank", "111-222-3333"],
                ["IBK", "444-555-6666"],
                ["Shinhan", "777-888-9999"],
                ["Hana Bank", "000-111-2222"],
            ])("should create with bankName %s and accNum %s", async (bankName, accNum) => {
                // Arrange
                const entity = BankAccountInfoEntity.create("TestArea", bankName, accNum);
                const createdRow = createBankAccountRow({
                    areaId: "TestArea",
                    bankName: bankName,
                    accNum: accNum,
                });
                bankAccountModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(bankAccountModel.create).toHaveBeenCalledWith({
                    data: {
                        areaId: "TestArea",
                        bankName: bankName,
                        accNum: accNum,
                    },
                });
                expect(result.bankName).toBe(bankName);
                expect(result.accNum).toBe(accNum);
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing BankAccountInfoEntity with changes", () => {
            it("should update bank account with correct data", async () => {
                // Arrange
                const entity = new BankAccountInfoEntity("Daegu", "Shinhan", "444-555-6666");
                const updatedRow = createBankAccountRow({
                    areaId: "Daegu",
                    bankName: "Shinhan",
                    accNum: "444-555-6666",
                });
                bankAccountModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(bankAccountModel.update).toHaveBeenCalledWith({
                    where: { areaId: "Daegu" },
                    data: {
                        bankName: "Shinhan",
                        accNum: "444-555-6666",
                    },
                });
                expect(result).toBeInstanceOf(BankAccountInfoEntity);
                expect(result).toMatchObject({
                    area: "Daegu",
                    bankName: "Shinhan",
                    accNum: "444-555-6666",
                });
            });
        });

        describe("given only bankName is changed", () => {
            it("should update with new bank name", async () => {
                // Arrange
                const entity = new BankAccountInfoEntity("Seoul", "Woori", "123-456-7890");
                const updatedRow = createBankAccountRow({
                    areaId: "Seoul",
                    bankName: "Woori",
                    accNum: "123-456-7890",
                });
                bankAccountModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(result.bankName).toBe("Woori");
            });
        });

        describe("given only accNum is changed", () => {
            it("should update with new account number", async () => {
                // Arrange
                const entity = new BankAccountInfoEntity("Seoul", "K-Bank", "999-888-7777");
                const updatedRow = createBankAccountRow({
                    areaId: "Seoul",
                    bankName: "K-Bank",
                    accNum: "999-888-7777",
                });
                bankAccountModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(result.accNum).toBe("999-888-7777");
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        describe("given a valid area", () => {
            it("should delete the bank account info", async () => {
                // Arrange
                bankAccountModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete("Daejeon");

                // Assert
                expect(bankAccountModel.delete).toHaveBeenCalledWith({ where: { areaId: "Daejeon" } });
            });
        });

        describe("given different areas", () => {
            it.each(["Seoul", "Incheon", "Busan", "Daegu"])(
                "should delete bank account for area %s",
                async (area) => {
                    // Arrange
                    bankAccountModel.delete.mockResolvedValue(undefined);

                    // Act
                    await repository.delete(area);

                    // Assert
                    expect(bankAccountModel.delete).toHaveBeenCalledWith({ where: { areaId: area } });
                }
            );
        });
    });
});
