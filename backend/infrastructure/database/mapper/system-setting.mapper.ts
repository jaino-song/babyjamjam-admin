import { system_setting as SystemSettingRow } from "@prisma/client";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

export class SystemSettingMapper {
    static toDomain(row: SystemSettingRow): SystemSettingEntity {
        return new SystemSettingEntity(row.key, row.value, row.updated_at);
    }

    static toPrismaUpsert(entity: SystemSettingEntity): {
        where: { key: string };
        create: { key: string; value: string };
        update: { value: string };
    } {
        return {
            where: { key: entity.key },
            create: { key: entity.key, value: entity.value },
            update: { value: entity.value },
        };
    }
}
