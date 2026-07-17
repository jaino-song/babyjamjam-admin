import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    CreateAreaTemplateUsecase,
    ListAreaTemplatesUsecase,
    FindAreaTemplateByAreaUsecase,
    UpdateAreaTemplateUsecase,
    DeleteAreaTemplateUsecase,
} from "application/usecases/area-template";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";

const DEFAULT_TEMPLATE_AREA_ID = "default";
const DEFAULT_TEMPLATE_NAME = "인천 아이미래로 전자계약서";

@Injectable()
export class AreaTemplateService {
    constructor(
        private readonly listAreaTemplatesUsecase: ListAreaTemplatesUsecase,
        private readonly createAreaTemplateUsecase: CreateAreaTemplateUsecase,
        private readonly findAreaTemplateByAreaUsecase: FindAreaTemplateByAreaUsecase,
        private readonly updateAreaTemplateUsecase: UpdateAreaTemplateUsecase,
        private readonly deleteAreaTemplateUsecase: DeleteAreaTemplateUsecase,
        private readonly configService: ConfigService,
    ) {}

    create(params: { area: string, templateId: string, templateName?: string | null }): Promise<AreaTemplateEntity> {
        return this.createAreaTemplateUsecase.execute(params.area, params.templateId, params.templateName ?? null);
    }

    async findAll(): Promise<AreaTemplateEntity[]> {
        const templates = await this.listAreaTemplatesUsecase.execute();
        return templates.length > 0 ? templates : [this.getDefaultTemplate()];
    }

    async findByArea(area: string): Promise<AreaTemplateEntity | null> {
        const template = await this.findAreaTemplateByAreaUsecase.execute(area);
        if (template || area !== DEFAULT_TEMPLATE_AREA_ID) {
            return template;
        }

        return this.getDefaultTemplate();
    }

    update(area: string, params: { templateId?: string, templateName?: string | null }): Promise<AreaTemplateEntity> {
        return this.updateAreaTemplateUsecase.execute(area, params);
    }

    delete(area: string) {
        return this.deleteAreaTemplateUsecase.execute(area);
    }

    private getDefaultTemplate(): AreaTemplateEntity {
        return AreaTemplateEntity.reconstitute(
            DEFAULT_TEMPLATE_AREA_ID,
            DEFAULT_TEMPLATE_AREA_ID,
            this.configService.getOrThrow<string>("EFORMSIGN_TEMPLATE_ID"),
            DEFAULT_TEMPLATE_NAME,
        );
    }
}
