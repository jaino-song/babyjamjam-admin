import { Module } from "@nestjs/common";
import {
    GetAllSystemTemplatesUseCase,
    GetSystemTemplateUseCase,
    GetVersionContentUseCase,
    GetVersionHistoryUseCase,
    RenderTemplateUseCase,
    ResetToDefaultUseCase,
    RollbackToVersionUseCase,
    UpdateSystemTemplateUseCase,
    ValidateTemplateContentUseCase,
} from "application/usecases/system-template";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateBootstrapService } from "application/services/system-template-bootstrap.service";
import { SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbSystemTemplateRepository } from "infrastructure/database/repositories/sb.system-template.repository";
import { SystemTemplateController } from "interface/controllers/system-template.controller";

@Module({
    providers: [
        {
            provide: SYSTEM_TEMPLATE_REPOSITORY,
            useClass: SbSystemTemplateRepository,
        },
        SystemTemplateService,
        GetAllSystemTemplatesUseCase,
        GetSystemTemplateUseCase,
        UpdateSystemTemplateUseCase,
        ValidateTemplateContentUseCase,
        RenderTemplateUseCase,
        GetVersionHistoryUseCase,
        GetVersionContentUseCase,
        RollbackToVersionUseCase,
        ResetToDefaultUseCase,
        SystemTemplateBootstrapService,
        PrismaService,
    ],
    controllers: [SystemTemplateController],
    exports: [SystemTemplateService],
})
export class SystemTemplateModule {}
