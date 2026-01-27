import { Injectable } from "@nestjs/common";
import {
    BulkUpdateVoucherPriceInfoUsecase,
    CreateVoucherPriceInfoUsecase,
    DeleteVoucherPriceInfoUsecase,
    FindVoucherPriceInfoByIdUsecase,
    FindVoucherPriceInfoByTypeUsecase,
    GetDistinctYearsUsecase,
    ListVoucherPriceInfoUsecase,
    ParseVoucherImageUsecase,
    UpdateVoucherPriceInfoUsecase,
} from "application/usecases/voucher-price-info";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { UpdateVoucherPriceInfoParams } from "application/usecases/voucher-price-info/update-voucher-price-info.usecase";
import { ParseImageResult, ParsedVoucherPriceData } from "domain/ports/gemini-api.port";
import { BulkUpdateResult } from "application/usecases/voucher-price-info/bulk-update-voucher-price-info.usecase";

export type CreateVoucherParams = {
    type: string;
    duration: bigint;
    fullPrice: string;
    grant: string;
    actualPrice: string;
    year: number;
};

@Injectable()
export class VoucherPriceInfoService {
    constructor(
        private readonly createVoucherPriceInfoUsecase: CreateVoucherPriceInfoUsecase,
        private readonly findVoucherPriceInfoByIdUsecase: FindVoucherPriceInfoByIdUsecase,
        private readonly findVoucherPriceInfoByTypeUsecase: FindVoucherPriceInfoByTypeUsecase,
        private readonly getDistinctYearsUsecase: GetDistinctYearsUsecase,
        private readonly listVoucherPriceInfoUsecase: ListVoucherPriceInfoUsecase,
        private readonly updateVoucherPriceInfoUsecase: UpdateVoucherPriceInfoUsecase,
        private readonly deleteVoucherPriceInfoUsecase: DeleteVoucherPriceInfoUsecase,
        private readonly parseVoucherImageUsecase: ParseVoucherImageUsecase,
        private readonly bulkUpdateVoucherPriceInfoUsecase: BulkUpdateVoucherPriceInfoUsecase,
    ) {}

    create(params: CreateVoucherParams): Promise<VoucherPriceInfoEntity> {
        return this.createVoucherPriceInfoUsecase.execute(
            params.type,
            params.duration,
            params.fullPrice,
            params.grant,
            params.actualPrice,
            params.year,
        );
    }

    findById(id: number): Promise<VoucherPriceInfoEntity | null> {
        return this.findVoucherPriceInfoByIdUsecase.execute(id);
    }

    findByType(type: string, year?: number): Promise<VoucherPriceInfoEntity[]> {
        return this.findVoucherPriceInfoByTypeUsecase.execute(type, year);
    }

    list(): Promise<VoucherPriceInfoEntity[]> {
        return this.listVoucherPriceInfoUsecase.execute();
    }

    update(id: number, params: UpdateVoucherPriceInfoParams): Promise<VoucherPriceInfoEntity> {
        return this.updateVoucherPriceInfoUsecase.execute(id, params);
    }

    delete(id: number): Promise<void> {
        return this.deleteVoucherPriceInfoUsecase.execute(id);
    }

    parseImage(file: Express.Multer.File): Promise<ParseImageResult> {
        return this.parseVoucherImageUsecase.execute(file);
    }

    bulkUpdate(items: ParsedVoucherPriceData[], year: number): Promise<BulkUpdateResult> {
        return this.bulkUpdateVoucherPriceInfoUsecase.execute(items, year);
    }

    getDistinctYears(): Promise<number[]> {
        return this.getDistinctYearsUsecase.execute();
    }
}

