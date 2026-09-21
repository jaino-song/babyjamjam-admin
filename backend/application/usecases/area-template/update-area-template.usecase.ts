import { Inject, Injectable } from "@nestjs/common";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { AREA_TEMPLATE_REPOSITORY, IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";
import {
    assertEformsignTemplateCanBeCreated,
    normalizeEformsignTemplateId,
} from "application/utils/eformsign-historical-template-policy";

@Injectable()
export class UpdateAreaTemplateUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    async execute(
        branchid: string,
        area: string,
        params: { templateId?: string; templateName?: string | null }
    ): Promise<AreaTemplateEntity> {
        const requestedTemplateId = params.templateId === undefined
            ? undefined
            : normalizeEformsignTemplateId(params.templateId);
        if (requestedTemplateId !== undefined) {
            assertEformsignTemplateCanBeCreated(requestedTemplateId);
        }
        const existing = await this.areaTemplateRepository.findByArea(branchid, area);
        if (!existing) {
            throw new Error(`AreaTemplate not found for area: ${area}`);
        }

        const existingTemplateId = normalizeEformsignTemplateId(existing.templateId);
        const effectiveTemplateId = requestedTemplateId ?? existingTemplateId;
        // A persisted retired row may be remediated by explicitly replacing it with
        // an active template. Name-only updates keep the retired value and remain
        // rejected, so the boundary cannot be bypassed.
        assertEformsignTemplateCanBeCreated(effectiveTemplateId);

        const updated = new AreaTemplateEntity(
            existing.id,
            existing.areaId,
            effectiveTemplateId,
            params.templateName !== undefined ? params.templateName : existing.templateName,
        );

        return this.areaTemplateRepository.update(branchid, updated);
    }
}
