import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
export declare class DeleteEmployeeUsecase {
    private readonly employeeRepository;
    constructor(employeeRepository: IEmployeeRepository);
    execute(id: number): Promise<void>;
}
