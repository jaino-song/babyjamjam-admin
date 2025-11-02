import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
export type UpdateEmployeeParams = {
    name?: string;
    workArea?: string;
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
};
export declare class UpdateEmployeeUsecase {
    private readonly employeeRepository;
    constructor(employeeRepository: IEmployeeRepository);
    execute(id: number, updates: UpdateEmployeeParams): Promise<EmployeeEntity>;
}
