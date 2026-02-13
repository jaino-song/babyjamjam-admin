import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SystemSettingModule } from "./system-setting.module";
import { ChannelTalkModule } from "./channeltalk.module";
import { AligoModule } from "./aligo.module";
import { AlimtalkService } from "application/services/alimtalk.service";
import { AlimtalkSchedulerService } from "application/services/alimtalk-scheduler.service";
import { ChannelTalkSchedulerService } from "application/services/channeltalk-scheduler.service";
import { AlimtalkRetrySchedulerService } from "application/services/alimtalk-retry-scheduler.service";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { ORGANIZATION_REPOSITORY } from "domain/repositories/organization.repository.interface";
import { SbOrganizationRepository } from "infrastructure/database/repositories/sb.organization.repository";
import { EMPLOYEE_SCHEDULE_REPOSITORY } from "domain/repositories/employee-schedule.repository.interface";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    imports: [ConfigModule, SystemSettingModule, ChannelTalkModule, AligoModule],
    providers: [
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        { provide: ORGANIZATION_REPOSITORY, useClass: SbOrganizationRepository },
        { provide: EMPLOYEE_SCHEDULE_REPOSITORY, useClass: SbEmployeeScheduleRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: SbEmployeeRepository },
        PrismaService,
        AlimtalkService,
        AlimtalkSchedulerService,
        ChannelTalkSchedulerService,
        AlimtalkRetrySchedulerService,
    ],
    exports: [AlimtalkService],
})
export class AlimtalkModule {}
