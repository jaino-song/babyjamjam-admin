import { Injectable } from "@nestjs/common";

import { OutOfPocketPriceInfoEntity } from "domain/entities/out-of-pocket-price-info.entity";
import { IOutOfPocketPriceInfoRepository } from "domain/repositories/out-of-pocket-price-info.repository.interface";

import { OutOfPocketPriceInfoMapper } from "../mapper/out-of-pocket-price-info.mapper";
import { PrismaService } from "../prisma.service";

@Injectable()
export class SbOutOfPocketPriceInfoRepository implements IOutOfPocketPriceInfoRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findAll(): Promise<OutOfPocketPriceInfoEntity[]> {
        const rows = await this.prismaService.out_of_pocket_price_info.findMany({
            orderBy: { duration: "asc" },
        });
        return rows.map((row) => OutOfPocketPriceInfoMapper.toDomain(row));
    }
}
