import { Inject, Injectable } from "@nestjs/common";
import { AREA_TEMPLATE_REPOSITORY, IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";

@Injectable()
export class DeleteAreaTemplateUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    execute(area: string): Promise<void> {
        return this.areaTemplateRepository.delete(area);
    }
}
