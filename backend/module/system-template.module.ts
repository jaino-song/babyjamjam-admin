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
    UpdateBranchSystemTemplateUseCase,
    ValidateTemplateContentUseCase,
} from "application/usecases/system-template";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateBootstrapService } from "application/services/system-template-bootstrap.service";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";
import { SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";
import { MESSAGE_TRIGGER_RULE_REPOSITORY } from "domain/repositories/message-trigger-rule.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbSystemTemplateRepository } from "infrastructure/database/repositories/sb.system-template.repository";
import { SystemTemplateController } from "interface/controllers/system-template.controller";
import { BranchSystemTemplateController } from "interface/controllers/branch-system-template.controller";

@Module({
    imports: [DatabaseModule],
    providers: [
        {
            provide: SYSTEM_TEMPLATE_REPOSITORY,
            useClass: SbSystemTemplateRepository,
        },
        {
            provide: MESSAGE_TRIGGER_RULE_REPOSITORY,
            useClass: SbMessageTriggerRuleRepository,
        },
        SystemTemplateService,
        MessageTemplateAutomationLockService,
        SystemTemplateMutationGuardService,
        GetAllSystemTemplatesUseCase,
        GetSystemTemplateUseCase,
        UpdateSystemTemplateUseCase,
        UpdateBranchSystemTemplateUseCase,
        ValidateTemplateContentUseCase,
        RenderTemplateUseCase,
        GetVersionHistoryUseCase,
        GetVersionContentUseCase,
        RollbackToVersionUseCase,
        ResetToDefaultUseCase,
        SystemTemplateBootstrapService,
    ],
    controllers: [SystemTemplateController, BranchSystemTemplateController],
    exports: [SystemTemplateService, MessageTemplateAutomationLockService],
})
export class SystemTemplateModule {}
