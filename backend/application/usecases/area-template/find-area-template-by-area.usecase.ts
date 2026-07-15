import { Inject, Injectable } from "@nestjs/common";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { AREA_TEMPLATE_REPOSITORY, IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";

@Injectable()
export class FindAreaTemplateByAreaUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    execute(branchid: string, area: string): Promise<AreaTemplateEntity | null> {
        return this.areaTemplateRepository.findByArea(branchid, area);
    }
}
