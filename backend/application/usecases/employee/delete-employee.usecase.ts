import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class DeleteEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(branchid: string, id: number): Promise<void> {
        const employee = await this.employeeRepository.findById(branchid, id);
        if (!employee || employee.deletedAt) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        if (!this.employeeRepository.hasActiveAssignments) {
            throw new Error("Employee repository does not support active assignment checks");
        }
        const hasActiveAssignments = await this.employeeRepository.hasActiveAssignments(branchid, id);
        if (hasActiveAssignments) {
            throw new ConflictException(codeOnlyProblemBody("EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED"));
        }
        await this.employeeRepository.delete(branchid, id);
    }
}
