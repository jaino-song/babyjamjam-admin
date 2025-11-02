import { CreateVoucherPriceInfoUsecase, DeleteVoucherPriceInfoUsecase, FindVoucherPriceInfoByIdUsecase, FindVoucherPriceInfoByTypeUsecase, ListVoucherPriceInfoUsecase, UpdateVoucherPriceInfoUsecase } from "application/usecases/voucher-price-info";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { UpdateVoucherPriceInfoParams } from "application/usecases/voucher-price-info/update-voucher-price-info.usecase";
export type CreateVoucherParams = {
    type: string;
    duration: bigint;
    fullPrice: string;
    grant: string;
    actualPrice: string;
};
export declare class VoucherPriceInfoService {
    private readonly createVoucherPriceInfoUsecase;
    private readonly findVoucherPriceInfoByIdUsecase;
    private readonly findVoucherPriceInfoByTypeUsecase;
    private readonly listVoucherPriceInfoUsecase;
    private readonly updateVoucherPriceInfoUsecase;
    private readonly deleteVoucherPriceInfoUsecase;
    constructor(createVoucherPriceInfoUsecase: CreateVoucherPriceInfoUsecase, findVoucherPriceInfoByIdUsecase: FindVoucherPriceInfoByIdUsecase, findVoucherPriceInfoByTypeUsecase: FindVoucherPriceInfoByTypeUsecase, listVoucherPriceInfoUsecase: ListVoucherPriceInfoUsecase, updateVoucherPriceInfoUsecase: UpdateVoucherPriceInfoUsecase, deleteVoucherPriceInfoUsecase: DeleteVoucherPriceInfoUsecase);
    create(params: CreateVoucherParams): Promise<VoucherPriceInfoEntity>;
    findById(id: number): Promise<VoucherPriceInfoEntity | null>;
    findByType(type: string): Promise<VoucherPriceInfoEntity | null>;
    list(): Promise<VoucherPriceInfoEntity[]>;
    update(id: number, params: UpdateVoucherPriceInfoParams): Promise<VoucherPriceInfoEntity>;
    delete(id: number): Promise<void>;
}
