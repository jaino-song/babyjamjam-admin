import { Injectable } from "@nestjs/common";
import { DailyRecordEntryEntity } from "domain/entities/daily-record-entry.entity";
import { IDailyRecordEntryRepository } from "domain/repositories/daily-record-entry.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { DailyRecordEntryMapper } from "infrastructure/database/mapper/daily-record-entry.mapper";

@Injectable()
export class SbDailyRecordEntryRepository implements IDailyRecordEntryRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(organizationid: string, id: string): Promise<DailyRecordEntryEntity | null> {
        const row = await this.prismaService.daily_record_entry.findFirst({
            where: { id, organizationId: organizationid },
        });
        return row ? DailyRecordEntryMapper.toDomain(row) : null;
    }

    async findByEformsignDocId(
        organizationid: string,
        eformsignDocId: number,
    ): Promise<DailyRecordEntryEntity[]> {
        const rows = await this.prismaService.daily_record_entry.findMany({
            where: { eformsignDocId, organizationId: organizationid },
            orderBy: { recordDate: "asc" },
        });
        return rows.map(DailyRecordEntryMapper.toDomain);
    }

    async findByEformsignDocIdAndDate(
        organizationid: string,
        eformsignDocId: number,
        recordDate: Date,
    ): Promise<DailyRecordEntryEntity | null> {
        const row = await this.prismaService.daily_record_entry.findFirst({
            where: {
                eformsignDocId,
                recordDate,
                organizationId: organizationid,
            },
        });
        return row ? DailyRecordEntryMapper.toDomain(row) : null;
    }

    async create(
        organizationid: string,
        entry: DailyRecordEntryEntity,
    ): Promise<DailyRecordEntryEntity> {
        const created = await this.prismaService.daily_record_entry.create({
            data: {
                ...DailyRecordEntryMapper.toPrismaCreate(entry),
                organizationId: organizationid,
            },
        });
        return DailyRecordEntryMapper.toDomain(created);
    }

    async delete(organizationid: string, id: string): Promise<void> {
        await this.prismaService.daily_record_entry.deleteMany({
            where: { id, organizationId: organizationid },
        });
    }
}
