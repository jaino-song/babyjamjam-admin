import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
export declare class FindEmployeeScheduleByIdUsecase {
    private readonly employeeScheduleRepository;
    constructor(employeeScheduleRepository: IEmployeeScheduleRepository);
    execute(id: number): Promise<EmployeeScheduleEntity | null>;
}
