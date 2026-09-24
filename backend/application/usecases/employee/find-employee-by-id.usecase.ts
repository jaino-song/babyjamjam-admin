import { Inject, Injectable } from "@nestjs/common";
import { EmployeeEntity, EmployeeStatus } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class FindEmployeeByIdUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    execute(branchid: string, id: number): Promise<EmployeeEntity | null> {
        return this.employeeRepository.findById(branchid, id);
    }

    /**
     * Best-effort computed working/available status for one employee on one
     * calendar date. Never used by `execute` — callers that need the base
     * lookup unchanged (e.g. writes) must keep calling `execute`.
     */
    async resolveStatus(branchid: string, id: number, date: Date): Promise<EmployeeStatus | undefined> {
        if (!this.employeeRepository.findByIdForDate) return undefined;
        const employee = await this.employeeRepository.findByIdForDate(branchid, id, date);
        return employee?.status;
    }
}
