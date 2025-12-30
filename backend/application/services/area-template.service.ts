import { Injectable } from "@nestjs/common";
import {
    CreateAreaTemplateUsecase,
    ListAreaTemplatesUsecase,
    FindAreaTemplateByAreaUsecase,
    UpdateAreaTemplateUsecase,
    DeleteAreaTemplateUsecase,
} from "application/usecases/area-template";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";

@Injectable()
export class AreaTemplateService {
    constructor(
        private readonly listAreaTemplatesUsecase: ListAreaTemplatesUsecase,
        private readonly createAreaTemplateUsecase: CreateAreaTemplateUsecase,
        private readonly findAreaTemplateByAreaUsecase: FindAreaTemplateByAreaUsecase,
        private readonly updateAreaTemplateUsecase: UpdateAreaTemplateUsecase,
        private readonly deleteAreaTemplateUsecase: DeleteAreaTemplateUsecase,
    ) {}

    create(params: { area: string, templateId: string, templateName?: string | null }): Promise<AreaTemplateEntity> {
        return this.createAreaTemplateUsecase.execute(params.area, params.templateId, params.templateName ?? null);
    }

    findAll(): Promise<AreaTemplateEntity[]> {
        return this.listAreaTemplatesUsecase.execute();
    }

    findByArea(area: string): Promise<AreaTemplateEntity | null> {
        return this.findAreaTemplateByAreaUsecase.execute(area);
    }

    update(area: string, params: { templateId?: string, templateName?: string | null }): Promise<AreaTemplateEntity> {
        return this.updateAreaTemplateUsecase.execute(area, params);
    }

    delete(area: string) {
        return this.deleteAreaTemplateUsecase.execute(area);
    }
}
