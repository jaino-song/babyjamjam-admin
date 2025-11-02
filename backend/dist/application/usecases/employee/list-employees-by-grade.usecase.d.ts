import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
export declare class ListEmployeesByGradeUsecase {
    private readonly employeeRepository;
    constructor(employeeRepository: IEmployeeRepository);
    execute(grade: string): Promise<EmployeeEntity[]>;
}
