import { Inject, Injectable } from "@nestjs/common";
import { AREA_TEMPLATE_REPOSITORY, IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";

@Injectable()
export class DeleteAreaTemplateUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    async execute(area: string): Promise<void> {
        const existing = await this.areaTemplateRepository.findByArea(area);
        if (!existing) {
            throw new Error(`AreaTemplate not found for area: ${area}`);
        }
        return this.areaTemplateRepository.delete(existing.id);
    }
}
