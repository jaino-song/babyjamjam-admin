import { Module } from "@nestjs/common";
import { SYSTEM_SETTING_REPOSITORY } from "domain/repositories/system-setting.repository.interface";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { SystemSettingService } from "application/services/system-setting.service";
import { SystemSettingController } from "interface/controllers/system-setting.controller";

@Module({
    controllers: [SystemSettingController],
    providers: [
        PrismaService,
        { provide: SYSTEM_SETTING_REPOSITORY, useClass: SbSystemSettingRepository },
        GetSettingUsecase,
        UpdateSettingUsecase,
        SystemSettingService,
    ],
    exports: [SystemSettingService],
})
export class SystemSettingModule {}
