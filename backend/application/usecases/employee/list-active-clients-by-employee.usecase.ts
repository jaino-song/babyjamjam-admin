import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    ActiveClientByEmployee,
    EMPLOYEE_REPOSITORY,
    IEmployeeRepository,
} from "domain/repositories/employee.repository.interface";

@Injectable()
export class ListActiveClientsByEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(branchid: string, employeeId: number): Promise<ActiveClientByEmployee[]> {
        const employee = await this.employeeRepository.findById(branchid, employeeId);
        if (!employee) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        if (employee.deletedAt) {
            return [];
        }
        if (!this.employeeRepository.findActiveClientsByEmployee) {
            throw new Error("Employee repository does not support active client lookups");
        }
        return this.employeeRepository.findActiveClientsByEmployee(branchid, employeeId);
    }
}
