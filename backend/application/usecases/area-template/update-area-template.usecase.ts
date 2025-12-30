import { Inject, Injectable } from "@nestjs/common";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { AREA_TEMPLATE_REPOSITORY, IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";

@Injectable()
export class UpdateAreaTemplateUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    async execute(area: string, params: { templateId?: string, templateName?: string | null }): Promise<AreaTemplateEntity> {
        const existing = await this.areaTemplateRepository.findByArea(area);
        if (!existing) {
            throw new Error(`AreaTemplate not found for area: ${area}`);
        }

        const updated = new AreaTemplateEntity(
            existing.id,
            existing.areaId,
            params.templateId ?? existing.templateId,
            params.templateName !== undefined ? params.templateName : existing.templateName,
        );

        return this.areaTemplateRepository.update(updated);
    }
}
