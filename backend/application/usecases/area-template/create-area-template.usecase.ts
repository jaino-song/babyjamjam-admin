import { Inject, Injectable } from "@nestjs/common";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { AREA_TEMPLATE_REPOSITORY, IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";

@Injectable()
export class CreateAreaTemplateUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    execute(area: string, templateId: string, templateName: string | null = null): Promise<AreaTemplateEntity> {
        const entity = AreaTemplateEntity.create(area, templateId, templateName);
        return this.areaTemplateRepository.create(entity);
    }
}
