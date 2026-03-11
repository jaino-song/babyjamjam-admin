import { Module } from "@nestjs/common";
import { SYSTEM_SETTING_REPOSITORY } from "domain/repositories/system-setting.repository.interface";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { SystemSettingService } from "application/services/system-setting.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemSettingController } from "interface/controllers/system-setting.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [SystemSettingController],
    providers: [
        { provide: SYSTEM_SETTING_REPOSITORY, useClass: SbSystemSettingRepository },
        GetSettingUsecase,
        UpdateSettingUsecase,
        SystemSettingService,
        MessageSenderApprovalService,
    ],
    exports: [SystemSettingService, MessageSenderApprovalService],
})
export class SystemSettingModule {}
