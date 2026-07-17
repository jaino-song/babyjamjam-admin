import { Module } from "@nestjs/common";
import {
    ChangeEmployeeOpenStatusUsecase,
    CreateEmployeeUsecase,
    DeleteEmployeeUsecase,
    FindEmployeeByIdUsecase,
    ListActiveClientsByEmployeeUsecase,
    ListEmployeesByGradeUsecase,
    ListEmployeesByOpenStatusUsecase,
    ListEmployeesByRegisteredDateRangeUsecase,
    ListEmployeesByRegisteredDateUsecase,
    ListEmployeesByWorkAreaUsecase,
    ListEmployeesOpenToNextWorkUsecase,
    ListEmployeesUsecase,
    UpdateEmployeeUsecase,
} from "application/usecases/employee";
import { EmployeeService } from "application/services/employee.service";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { EmployeeController } from "interface/controllers/employee.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [EmployeeController],
    providers: [
        CreateEmployeeUsecase,
        FindEmployeeByIdUsecase,
        ListActiveClientsByEmployeeUsecase,
        UpdateEmployeeUsecase,
        DeleteEmployeeUsecase,
        ListEmployeesUsecase,
        ListEmployeesByWorkAreaUsecase,
        ListEmployeesByGradeUsecase,
        ListEmployeesByOpenStatusUsecase,
        ListEmployeesByRegisteredDateUsecase,
        ListEmployeesByRegisteredDateRangeUsecase,
        ChangeEmployeeOpenStatusUsecase,
        ListEmployeesOpenToNextWorkUsecase,
        EmployeeService,
        {
            provide: EMPLOYEE_REPOSITORY,
            useClass: SbEmployeeRepository,
        },
    ],
    exports: [EmployeeService],
})
export class EmployeeModule {}
