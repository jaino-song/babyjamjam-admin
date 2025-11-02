import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { CreateVoucherPriceInfoDto, UpdateVoucherPriceInfoDto } from "interface/dto/voucher-price-info.dto";
export declare class VoucherPriceInfoController {
    private readonly voucherService;
    constructor(voucherService: VoucherPriceInfoService);
    create(dto: CreateVoucherPriceInfoDto): Promise<import("../../domain/entities/voucher-price-info.entity").VoucherPriceInfoEntity>;
    list(): Promise<import("../../domain/entities/voucher-price-info.entity").VoucherPriceInfoEntity[]>;
    findById(id: string): Promise<import("../../domain/entities/voucher-price-info.entity").VoucherPriceInfoEntity>;
    findByType(type: string): Promise<import("../../domain/entities/voucher-price-info.entity").VoucherPriceInfoEntity>;
    update(id: string, dto: UpdateVoucherPriceInfoDto): Promise<import("../../domain/entities/voucher-price-info.entity").VoucherPriceInfoEntity>;
    delete(id: string): Promise<void>;
}
