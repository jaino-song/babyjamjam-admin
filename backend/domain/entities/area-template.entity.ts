export class AreaTemplateEntity {
    constructor(
        public readonly id: string,
        public readonly areaId: string,
        public templateId: string,
        public templateName: string | null,
    ) {}

    static create(areaId: string, templateId: string, templateName: string | null = null): AreaTemplateEntity {
        return new AreaTemplateEntity('', areaId, templateId, templateName);
    }

    static fromPrisma(prismaData: { id: string, area_id: string, template_id: string, template_name: string | null }): AreaTemplateEntity {
        return new AreaTemplateEntity(prismaData.id, prismaData.area_id, prismaData.template_id, prismaData.template_name);
    }

    toPersistence(): { area_id: string, template_id: string, template_name: string | null } {
        return {
            area_id: this.areaId,
            template_id: this.templateId,
            template_name: this.templateName,
        };
    }
}
