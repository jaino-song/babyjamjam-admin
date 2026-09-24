import { Inject, Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class ListEmployeesForDateUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    execute(branchid: string, date: Date): Promise<EmployeeEntity[]> {
        if (!this.employeeRepository.findAllForDate) {
            throw new Error("Employee repository does not support date-scoped listing");
        }
        return this.employeeRepository.findAllForDate(branchid, date);
    }
}
