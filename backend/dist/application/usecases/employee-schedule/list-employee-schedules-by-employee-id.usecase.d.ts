import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
export declare class ListEmployeeSchedulesByEmployeeIdUsecase {
    private readonly employeeScheduleRepository;
    constructor(employeeScheduleRepository: IEmployeeScheduleRepository);
    execute(employeeId: number): Promise<EmployeeScheduleEntity[]>;
}
