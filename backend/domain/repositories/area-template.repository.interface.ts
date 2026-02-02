import { AreaTemplateEntity } from "domain/entities/area-template.entity";

export interface IAreaTemplateRepository {
    findAll(organizationid: string): Promise<AreaTemplateEntity[]>;
    findByArea(organizationid: string, area: string): Promise<AreaTemplateEntity | null>;
    create(organizationid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    update(organizationid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    delete(organizationid: string, id: string): Promise<void>;
}

export const AREA_TEMPLATE_REPOSITORY = 'AREA_TEMPLATE_REPOSITORY';
