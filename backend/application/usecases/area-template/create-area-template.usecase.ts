import { Inject, Injectable } from "@nestjs/common";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { AREA_TEMPLATE_REPOSITORY, IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";
import {
    assertEformsignTemplateCanBeCreated,
    normalizeEformsignTemplateId,
} from "application/utils/eformsign-historical-template-policy";

@Injectable()
export class CreateAreaTemplateUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    execute(
        branchid: string,
        area: string,
        templateId: string,
        templateName: string | null = null
    ): Promise<AreaTemplateEntity> {
        const normalizedTemplateId = normalizeEformsignTemplateId(templateId);
        assertEformsignTemplateCanBeCreated(normalizedTemplateId);
        const entity = AreaTemplateEntity.create(area, normalizedTemplateId, templateName);
        return this.areaTemplateRepository.create(branchid, entity);
    }
}
