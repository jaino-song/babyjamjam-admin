import { Inject, Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class ListEmployeesByGradeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    execute(organizationid: string, grade: string): Promise<EmployeeEntity[]> {
        return this.employeeRepository.findByGrade(organizationid, grade);
    }
}
