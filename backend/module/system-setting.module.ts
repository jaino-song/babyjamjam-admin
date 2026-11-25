import { MESSAGE_TRIGGER_RULE_REPOSITORY } from "domain/repositories/message-trigger-rule.repository.interface";
import { MESSAGE_TRIGGER_JOB_REPOSITORY } from "domain/repositories/message-trigger-job.repository.interface";
import { MESSAGE_LOG_REPOSITORY } from "domain/repositories/message-log.repository.interface";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { Module } from "@nestjs/common";
import { SYSTEM_SETTING_REPOSITORY } from "domain/repositories/system-setting.repository.interface";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { SystemSettingService } from "application/services/system-setting.service";
import { EformsignAutomationStatusService } from "application/services/eformsign-automation-status.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemSettingController } from "interface/controllers/system-setting.controller";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { PublicSettingsController } from "interface/controllers/public-settings.controller";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MESSAGE_AUTOMATION_DATABASE } from "domain/repositories/message-automation-database.repository.interface";
import { CANCELED_AUTOMATION_RETRY_REPOSITORY } from "domain/repositories/canceled-automation-retry.repository.interface";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import { CanceledAutomationRetryRepository } from "infrastructure/database/repositories/canceled-automation-retry.repository";
import { CanceledAutomationRetrySettingsController } from "interface/controllers/canceled-automation-retry-settings.controller";

import { EformsignWebhookEventModule } from "./eformsign-webhook-event.module";

@Module({
    imports: [DatabaseModule, EformsignWebhookEventModule],
    controllers: [SystemSettingController, PublicSettingsController, CanceledAutomationRetrySettingsController],
    providers: [
        { provide: MESSAGE_TRIGGER_RULE_REPOSITORY, useClass: SbMessageTriggerRuleRepository },
        { provide: MESSAGE_TRIGGER_JOB_REPOSITORY, useClass: SbMessageTriggerJobRepository },
        { provide: MESSAGE_LOG_REPOSITORY, useClass: SbMessageLogRepository },
        { provide: SYSTEM_SETTING_REPOSITORY, useClass: SbSystemSettingRepository },
        GetSettingUsecase,
        UpdateSettingUsecase,
        SystemSettingService,
        BranchManagerGuard,
        MessageSenderApprovalService,
        EformsignAutomationStatusService,
        AdminAuditEventWriter,
        { provide: MESSAGE_AUTOMATION_DATABASE, useExisting: PrismaService },
        MessageAutomationBranchLockService,
        MessageAutomationActivationService,
        { provide: CANCELED_AUTOMATION_RETRY_REPOSITORY, useClass: CanceledAutomationRetryRepository },
        CanceledAutomationRetrySettingsService,
    ],
    exports: [
        CanceledAutomationRetrySettingsService,
        MESSAGE_AUTOMATION_DATABASE,
        GetSettingUsecase,
        UpdateSettingUsecase,
        SystemSettingService,
        MessageSenderApprovalService,
        MessageAutomationBranchLockService,
        MessageAutomationActivationService,
    ],
})
export class SystemSettingModule {}
