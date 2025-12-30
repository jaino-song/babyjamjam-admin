import { AreaTemplateEntity } from "domain/entities/area-template.entity";

type AreaTemplateRow = {
    id: string;
    area_id: string;
    template_id: string;
    template_name: string | null;
};

export class AreaTemplateMapper {
    static toDomain(row: AreaTemplateRow): AreaTemplateEntity {
        return new AreaTemplateEntity(row.id, row.area_id, row.template_id, row.template_name);
    }

    static toPrismaCreate(entity: AreaTemplateEntity) {
        return {
            area_id: entity.areaId,
            template_id: entity.templateId,
            template_name: entity.templateName,
        };
    }

    static toPrismaUpdate(entity: AreaTemplateEntity) {
        return {
            template_id: entity.templateId,
            template_name: entity.templateName,
        };
    }
}
