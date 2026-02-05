import { Inject, Injectable } from "@nestjs/common";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class DeleteEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(organizationid: string, id: number): Promise<void> {
        await this.employeeRepository.delete(organizationid, id);
    }
}
