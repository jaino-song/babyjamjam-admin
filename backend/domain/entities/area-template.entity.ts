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

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: string,
        areaId: string,
        templateId: string,
        templateName: string | null,
    ): AreaTemplateEntity {
        return new AreaTemplateEntity(id, areaId, templateId, templateName);
    }
}
