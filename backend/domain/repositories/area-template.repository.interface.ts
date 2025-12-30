import { AreaTemplateEntity } from "domain/entities/area-template.entity";

export interface IAreaTemplateRepository {
    findAll(): Promise<AreaTemplateEntity[]>;
    findByArea(area: string): Promise<AreaTemplateEntity | null>;
    create(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    update(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    delete(id: string): Promise<void>;
}

export const AREA_TEMPLATE_REPOSITORY = 'AREA_TEMPLATE_REPOSITORY';
