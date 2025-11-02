import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
export declare class CreateEmployeeUsecase {
    private readonly employeeRepository;
    constructor(employeeRepository: IEmployeeRepository);
    execute(name: string, workArea: string, phone: string, grade: string, openToNextWork: boolean, registeredDate?: Date): Promise<EmployeeEntity>;
}
