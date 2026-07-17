import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class DeleteEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(branchid: string, id: number): Promise<void> {
        if (!this.employeeRepository.hasActiveAssignments) {
            throw new Error("Employee repository does not support active assignment checks");
        }
        const hasActiveAssignments = await this.employeeRepository.hasActiveAssignments(branchid, id);
        if (hasActiveAssignments) {
            throw new ConflictException("진행 중인 배정이 있는 직원은 삭제할 수 없습니다. 배정 종료 또는 교체 후 다시 시도해 주세요.");
        }
        await this.employeeRepository.delete(branchid, id);
    }
}
