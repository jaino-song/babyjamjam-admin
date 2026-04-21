import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SystemSettingModule } from "./system-setting.module";
import { ChannelTalkModule } from "./channeltalk.module";
import { AligoModule } from "./aligo.module";
import { AlimtalkService } from "application/services/alimtalk.service";
import { AlimtalkSchedulerService } from "application/services/alimtalk-scheduler.service";
import { ChannelTalkSchedulerService } from "application/services/channeltalk-scheduler.service";
import { AlimtalkRetrySchedulerService } from "application/services/alimtalk-retry-scheduler.service";
import { AlimtalkTriggerService } from "application/services/alimtalk-trigger.service";
import { AlimtalkTriggerSchedulerService } from "application/services/alimtalk-trigger-scheduler.service";
import { AlimtalkTriggerDeliveryService } from "application/services/alimtalk-trigger-delivery.service";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { BRANCH_REPOSITORY } from "domain/repositories/branch.repository.interface";
import { SbBranchRepository } from "infrastructure/database/repositories/sb.branch.repository";
import { EMPLOYEE_SCHEDULE_REPOSITORY } from "domain/repositories/employee-schedule.repository.interface";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { ALIMTALK_TRIGGER_RULE_REPOSITORY } from "domain/repositories/alimtalk-trigger-rule.repository.interface";
import { SbAlimtalkTriggerRuleRepository } from "infrastructure/database/repositories/sb.alimtalk-trigger-rule.repository";
import { ALIMTALK_TRIGGER_JOB_REPOSITORY } from "domain/repositories/alimtalk-trigger-job.repository.interface";
import { SbAlimtalkTriggerJobRepository } from "infrastructure/database/repositories/sb.alimtalk-trigger-job.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { AlimtalkTriggerController } from "interface/controllers/alimtalk-trigger.controller";
import { AlimtalkTemplateController } from "interface/controllers/alimtalk-template.controller";
import { AlimtalkTemplateService } from "application/services/alimtalk-template.service";

@Module({
    imports: [DatabaseModule, ConfigModule, SystemSettingModule, ChannelTalkModule, AligoModule],
    controllers: [AlimtalkTriggerController, AlimtalkTemplateController],
    providers: [
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        { provide: BRANCH_REPOSITORY, useClass: SbBranchRepository },
        { provide: EMPLOYEE_SCHEDULE_REPOSITORY, useClass: SbEmployeeScheduleRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: SbEmployeeRepository },
        { provide: ALIMTALK_TRIGGER_RULE_REPOSITORY, useClass: SbAlimtalkTriggerRuleRepository },
        { provide: ALIMTALK_TRIGGER_JOB_REPOSITORY, useClass: SbAlimtalkTriggerJobRepository },
        AlimtalkService,
        AlimtalkSchedulerService,
        ChannelTalkSchedulerService,
        AlimtalkRetrySchedulerService,
        AlimtalkTriggerDeliveryService,
        AlimtalkTriggerService,
        AlimtalkTriggerSchedulerService,
        AlimtalkTemplateService,
    ],
    exports: [AlimtalkService, AlimtalkTriggerService],
})
export class AlimtalkModule {}
