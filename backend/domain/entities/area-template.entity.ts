export class AreaTemplateEntity {
    constructor(
        public readonly area: string,
        public templateId: string,
        public templateName: string | null,
    ) {}

    static create(area: string, templateId: string, templateName: string | null = null): AreaTemplateEntity {
        return new AreaTemplateEntity(area, templateId, templateName);
    }

    static fromPrisma(prismaData: { area: string, template_id: string, template_name: string | null }): AreaTemplateEntity {
        return new AreaTemplateEntity(prismaData.area, prismaData.template_id, prismaData.template_name);
    }

    toPersistence(): { area: string, template_id: string, template_name: string | null } {
        return {
            area: this.area,
            template_id: this.templateId,
            template_name: this.templateName,
        };
    }
}
