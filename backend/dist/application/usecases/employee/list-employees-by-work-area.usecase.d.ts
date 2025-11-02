import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
export declare class ListEmployeesByWorkAreaUsecase {
    private readonly employeeRepository;
    constructor(employeeRepository: IEmployeeRepository);
    execute(workArea: string): Promise<EmployeeEntity[]>;
}
