import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ParsedVoucherPriceData } from "domain/ports/gemini-api.port";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface BulkUpdateResult {
  updated: number[];
  created: number[];
  errors: string[];
}

@Injectable()
export class BulkUpdateVoucherPriceInfoUsecase {
  private readonly logger = new Logger(BulkUpdateVoucherPriceInfoUsecase.name);

  constructor(private readonly prismaService: PrismaService) {}

  async execute(items: ParsedVoucherPriceData[], year: number): Promise<BulkUpdateResult> {
    if (!year || year < 2000 || year > 2100) {
      throw new BadRequestException("유효한 연도를 입력해주세요 (2000-2100)");
    }

    this.logger.log(`Bulk updating ${items.length} voucher price items for year ${year}`);

    // 트랜잭션으로 원자적 업데이트
    const result = await this.prismaService.$transaction(async (tx) => {
      const updated: number[] = [];
      const created: number[] = [];
      const errors: string[] = [];

      for (const item of items) {
        try {
          // year + type + duration 조합으로 기존 레코드 확인 (unique constraint)
          const existing = await tx.voucher_price_info.findFirst({
            where: {
              year: year,
              type: item.type,
              duration: BigInt(item.duration),
            },
          });

          if (existing) {
            // 기존 레코드 업데이트
            await tx.voucher_price_info.update({
              where: { id: existing.id },
              data: {
                fullPrice: item.fullPrice,
                grant: item.grant,
                actualPrice: item.actualPrice,
              },
            });
            updated.push(existing.id);
            this.logger.debug(
              `Updated voucher price info: id=${existing.id}, year=${year}, type=${item.type}, duration=${item.duration}`,
            );
          } else {
            const createdRow = await tx.voucher_price_info.create({
              data: {
                year: year,
                type: item.type,
                duration: BigInt(item.duration),
                fullPrice: item.fullPrice,
                grant: item.grant,
                actualPrice: item.actualPrice,
              },
              select: { id: true },
            });
            created.push(createdRow.id);
            this.logger.debug(
              `Created voucher price info: id=${createdRow.id}, year=${year}, type=${item.type}, duration=${item.duration}`,
            );
          }
        } catch (error) {
          const errorMsg = `${item.type} (${item.duration}일, ${year}년) 처리 실패: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          this.logger.error(errorMsg);
        }
      }

      return { updated, created, errors };
    });

    this.logger.log(
      `Bulk update completed: ${result.updated.length} updated, ${result.created.length} created, ${result.errors.length} errors`,
    );

    return result;
  }
}
