import { Inject, Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";

@Injectable()
export class ListEmployeeSchedulesBySecondaryEmployeeIdUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
    ) {}

    execute(organizationid: string, secondaryEmployeeId: number): Promise<EmployeeScheduleEntity[]> {
        return this.employeeScheduleRepository.findBySecondaryEmployeeId(
            organizationid,
            secondaryEmployeeId
        );
    }
}
