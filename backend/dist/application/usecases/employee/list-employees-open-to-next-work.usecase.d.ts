import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
export declare class ListEmployeesOpenToNextWorkUsecase {
    private readonly employeeRepository;
    constructor(employeeRepository: IEmployeeRepository);
    execute(): Promise<EmployeeEntity[]>;
}
