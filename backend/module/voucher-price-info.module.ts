import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";
import { GEMINI_API_CLIENT } from "domain/ports/gemini-api.port";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbVoucherPriceInfoRepository } from "infrastructure/database/repositories/sb.voucher-price-info.repository";
import { GeminiApiClient } from "infrastructure/api/gemini-api.client";
import { VoucherPriceInfoController } from "interface/controllers/voucher-price-info.controller";

@Module({
    imports: [ConfigModule],
    controllers: [VoucherPriceInfoController],
    providers: [
        // Use Cases
        CreateVoucherPriceInfoUsecase,
        DeleteVoucherPriceInfoUsecase,
        FindVoucherPriceInfoByIdUsecase,
        FindVoucherPriceInfoByTypeUsecase,
        GetDistinctYearsUsecase,
        ListVoucherPriceInfoUsecase,
        UpdateVoucherPriceInfoUsecase,
        ParseVoucherImageUsecase,
        BulkUpdateVoucherPriceInfoUsecase,
        // Services
        VoucherPriceInfoService,
        PrismaService,
        // Repository bindings (Ports & Adapters)
        {
            provide: VOUCHER_PRICE_INFO_REPOSITORY,
            useClass: SbVoucherPriceInfoRepository,
        },
        {
            provide: GEMINI_API_CLIENT,
            useClass: GeminiApiClient,
        },
    ],
    exports: [VoucherPriceInfoService],
})
export class VoucherPriceInfoModule {}

