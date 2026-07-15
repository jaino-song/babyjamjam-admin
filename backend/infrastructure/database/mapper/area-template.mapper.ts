import { AreaTemplateEntity } from "domain/entities/area-template.entity";

type AreaTemplateRow = {
    id: string;
    areaId: string;
    templateId: string;
    templateName: string | null;
};

export class AreaTemplateMapper {
    static toDomain(row: AreaTemplateRow): AreaTemplateEntity {
        return new AreaTemplateEntity(row.id, row.areaId, row.templateId, row.templateName);
    }

    static toPrismaCreate(entity: AreaTemplateEntity) {
        return {
            areaId: entity.areaId,
            templateId: entity.templateId,
            templateName: entity.templateName,
        };
    }

    static toPrismaUpdate(entity: AreaTemplateEntity) {
        return {
            templateId: entity.templateId,
            templateName: entity.templateName,
        };
    }
}
