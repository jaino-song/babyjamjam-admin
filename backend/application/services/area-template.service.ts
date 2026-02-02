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

    create(
        organizationid: string,
        params: { area: string; templateId: string; templateName?: string | null }
    ): Promise<AreaTemplateEntity> {
        return this.createAreaTemplateUsecase.execute(
            organizationid,
            params.area,
            params.templateId,
            params.templateName ?? null
        );
    }

    findAll(organizationid: string): Promise<AreaTemplateEntity[]> {
        return this.listAreaTemplatesUsecase.execute(organizationid);
    }

    findByArea(organizationid: string, area: string): Promise<AreaTemplateEntity | null> {
        return this.findAreaTemplateByAreaUsecase.execute(organizationid, area);
    }

    update(
        organizationid: string,
        area: string,
        params: { templateId?: string; templateName?: string | null }
    ): Promise<AreaTemplateEntity> {
        return this.updateAreaTemplateUsecase.execute(organizationid, area, params);
    }

    delete(organizationid: string, area: string) {
        return this.deleteAreaTemplateUsecase.execute(organizationid, area);
    }
}
