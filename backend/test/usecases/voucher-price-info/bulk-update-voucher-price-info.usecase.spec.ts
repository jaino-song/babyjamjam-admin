import { BadRequestException } from "@nestjs/common";
import { BulkUpdateVoucherPriceInfoUsecase } from "application/usecases/voucher-price-info/bulk-update-voucher-price-info.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("BulkUpdateVoucherPriceInfoUsecase", () => {
  const tx = {
    voucher_price_info: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  let prismaService: PrismaService;
  let usecase: BulkUpdateVoucherPriceInfoUsecase;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService = {
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    usecase = new BulkUpdateVoucherPriceInfoUsecase(prismaService);
  });

  it("creates new voucher rows without manually assigning primary keys", async () => {
    tx.voucher_price_info.findFirst.mockResolvedValue(null);
    tx.voucher_price_info.create.mockResolvedValue({ id: 42 });

    const result = await usecase.execute(
      [
        {
          type: "standard",
          duration: 10,
          fullPrice: "100000",
          grant: "70000",
          actualPrice: "30000",
        },
      ],
      2026,
    );

    expect(tx.voucher_price_info.create).toHaveBeenCalledWith({
      data: {
        year: 2026,
        type: "standard",
        duration: BigInt(10),
        fullPrice: "100000",
        grant: "70000",
        actualPrice: "30000",
      },
      select: { id: true },
    });
    expect(result).toEqual({ updated: [], created: [42], errors: [] });
  });

  it("updates existing voucher rows by unique year type and duration", async () => {
    tx.voucher_price_info.findFirst.mockResolvedValue({ id: 7 });

    const result = await usecase.execute(
      [
        {
          type: "standard",
          duration: 10,
          fullPrice: "120000",
          grant: "80000",
          actualPrice: "40000",
        },
      ],
      2026,
    );

    expect(tx.voucher_price_info.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        fullPrice: "120000",
        grant: "80000",
        actualPrice: "40000",
      },
    });
    expect(tx.voucher_price_info.create).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: [7], created: [], errors: [] });
  });

  it("rejects invalid years before opening a transaction", async () => {
    await expect(usecase.execute([], 1999)).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });
});
