import { Module } from "@nestjs/common";
import {
    CreateEmployeeScheduleUsecase,
    DeleteEmployeeScheduleUsecase,
    FindEmployeeScheduleByIdUsecase,
    ListEmployeeSchedulesByPrimaryEmployeeIdUsecase,
    ListEmployeeSchedulesBySecondaryEmployeeIdUsecase,
    ListEmployeeSchedulesUsecase,
    UpdateEmployeeScheduleUsecase,
} from "application/usecases/employee-schedule";
import { EMPLOYEE_SCHEDULE_REPOSITORY } from "domain/repositories/employee-schedule.repository.interface";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { EmployeeScheduleController } from "interface/controllers/employee-schedule.controller";
import { MessageModule } from "./message.module";
import { ServiceFeedbackModule } from "./service-feedback.module";

@Module({
    imports: [DatabaseModule, MessageModule, ServiceFeedbackModule],
    controllers: [EmployeeScheduleController],
    providers: [
        CreateEmployeeScheduleUsecase,
        DeleteEmployeeScheduleUsecase,
        FindEmployeeScheduleByIdUsecase,
        ListEmployeeSchedulesByPrimaryEmployeeIdUsecase,
        ListEmployeeSchedulesBySecondaryEmployeeIdUsecase,
        ListEmployeeSchedulesUsecase,
        UpdateEmployeeScheduleUsecase,
        EmployeeScheduleService,
        {
            provide: EMPLOYEE_SCHEDULE_REPOSITORY,
            useClass: SbEmployeeScheduleRepository,
        },
    ],
    exports: [EmployeeScheduleService],
})
export class EmployeeScheduleModule {}
