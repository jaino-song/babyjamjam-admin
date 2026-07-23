import { ListOutOfPocketPriceInfoUsecase } from "application/usecases/out-of-pocket-price-info/list-out-of-pocket-price-info.usecase";
import type { IOutOfPocketPriceInfoRepository } from "domain/repositories/out-of-pocket-price-info.repository.interface";

describe("ListOutOfPocketPriceInfoUsecase", () => {
    it("should return out-of-pocket prices ordered by duration", async () => {
        const priceInfos = [
            { id: 1, duration: 5, fullPrice: "815000" },
            { id: 2, duration: 10, fullPrice: "1620000" },
        ];
        const repository: jest.Mocked<IOutOfPocketPriceInfoRepository> = {
            findAll: jest.fn().mockResolvedValue(priceInfos),
        };
        const usecase = new ListOutOfPocketPriceInfoUsecase(repository);

        await expect(usecase.execute()).resolves.toEqual(priceInfos);
        expect(repository.findAll).toHaveBeenCalledTimes(1);
    });
});
