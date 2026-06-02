import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import {
  BulkUpdateVoucherPriceInfoDto,
  CreateVoucherPriceInfoDto,
  UpdateVoucherPriceInfoDto,
} from "interface/dto/voucher-price-info.dto";

@Controller("voucher-price-infos")
export class VoucherPriceInfoController {
    constructor(private readonly voucherService: VoucherPriceInfoService) {}

    @Post()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    create(@Body() dto: CreateVoucherPriceInfoDto) {
        return this.voucherService.create({
            type: dto.type,
            duration: BigInt(dto.duration),
            fullPrice: dto.fullPrice,
            grant: dto.grant,
            actualPrice: dto.actualPrice,
            year: dto.year,
        });
    }

    @Get()
    list() {
        return this.voucherService.list();
    }

    @Get("type")
    findByType(@Query("type") type: string, @Query("year") year?: string) {
        return this.voucherService.findByType(type, year ? Number(year) : undefined);
    }

    @Get("years")
    getDistinctYears() {
        return this.voucherService.getDistinctYears();
    }

    @Get("id")
    findById(@Query("id", ParseIntPipe) id: number) {
        return this.voucherService.findById(id);
    }

    @Patch()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    update(@Query("id", ParseIntPipe) id: number, @Body() dto: UpdateVoucherPriceInfoDto) {
        return this.voucherService.update(id, {
            type: dto.type ?? undefined,
            duration: dto.duration != null ? BigInt(dto.duration) : undefined,
            fullPrice: dto.fullPrice ?? undefined,
            grant: dto.grant ?? undefined,
            actualPrice: dto.actualPrice ?? undefined,
            year: dto.year ?? undefined,
        });
    }

    @Delete()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    delete(@Query("id", ParseIntPipe) id: number) {
        return this.voucherService.delete(id);
    }

    /**
     * 바우처 요금표 이미지 파싱
     * POST /voucher-price-infos/parse-image
     */
    @Post("parse-image")
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    @UseInterceptors(FileInterceptor("image"))
    parseImage(@UploadedFile() file: Express.Multer.File) {
        return this.voucherService.parseImage(file);
    }

    /**
     * 바우처 가격 정보 일괄 업데이트
     * POST /voucher-price-infos/bulk-update
     * @param dto.items - 파싱된 바우처 가격 항목 배열
     * @param dto.year - 적용 연도 (unique constraint: year + type + duration)
     */
    @Post("bulk-update")
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    bulkUpdate(@Body() dto: BulkUpdateVoucherPriceInfoDto) {
        return this.voucherService.bulkUpdate(dto.items, dto.year);
    }
}
