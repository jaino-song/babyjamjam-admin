import { Inject, Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class ListEmployeesByRegisteredDateUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    execute(branchid: string, registeredDate: Date): Promise<EmployeeEntity[]> {
        return this.employeeRepository.findByRegisteredDate(branchid, registeredDate);
    }
}
