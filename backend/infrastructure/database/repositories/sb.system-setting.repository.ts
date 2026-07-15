import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ISystemSettingRepository } from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";
import { SystemSettingMapper } from "infrastructure/database/mapper/system-setting.mapper";

@Injectable()
export class SbSystemSettingRepository implements ISystemSettingRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findByKey(key: string): Promise<SystemSettingEntity | null> {
        const row = await this.prismaService.system_setting.findUnique({
            where: { key },
        });
        return row ? SystemSettingMapper.toDomain(row) : null;
    }

    async upsert(entity: SystemSettingEntity): Promise<SystemSettingEntity> {
        const upsertArgs = SystemSettingMapper.toPrismaUpsert(entity);
        const row = await this.prismaService.system_setting.upsert(upsertArgs);
        return SystemSettingMapper.toDomain(row);
    }
}
