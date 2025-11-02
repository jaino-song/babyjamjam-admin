import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
export declare class ChangeEmployeeOpenStatusUsecase {
    private readonly employeeRepository;
    constructor(employeeRepository: IEmployeeRepository);
    execute(id: number, openToNextWork: boolean): Promise<EmployeeEntity>;
}
