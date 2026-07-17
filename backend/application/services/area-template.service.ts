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

const LEGACY_CONTRACT_TEMPLATES = [
    {
        areaId: "Namdonggu",
        configKey: "EFORMSIGN_NAMDONG_TEMPLATE_ID",
        templateName: "인천 아이미래로 남동구 계약서",
    },
    {
        areaId: "Seogu",
        configKey: "EFORMSIGN_SEOGU_TEMPLATE_ID",
        templateName: "인천 아이미래로 서구 계약서",
    },
] as const;

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
        return templates.length > 0 ? templates : this.getConfiguredTemplates();
    }

    async findByArea(area: string): Promise<AreaTemplateEntity | null> {
        const template = await this.findAreaTemplateByAreaUsecase.execute(area);
        if (template) {
            return template;
        }

        return this.getConfiguredTemplates().find((configured) => configured.areaId === area) ?? null;
    }

    update(area: string, params: { templateId?: string, templateName?: string | null }): Promise<AreaTemplateEntity> {
        return this.updateAreaTemplateUsecase.execute(area, params);
    }

    delete(area: string) {
        return this.deleteAreaTemplateUsecase.execute(area);
    }

    private getConfiguredTemplates(): AreaTemplateEntity[] {
        return LEGACY_CONTRACT_TEMPLATES.map(({ areaId, configKey, templateName }) =>
            AreaTemplateEntity.reconstitute(
                areaId,
                areaId,
                this.configService.getOrThrow<string>(configKey),
                templateName,
            ),
        );
    }
}
