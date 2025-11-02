import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
type UpdateEmployeeScheduleParams = {
    workAddress?: string;
    startDate?: Date;
    endDate?: Date;
    replaced?: boolean;
};
export declare class UpdateEmployeeScheduleUsecase {
    private readonly employeeScheduleRepository;
    constructor(employeeScheduleRepository: IEmployeeScheduleRepository);
    execute(id: number, updates: UpdateEmployeeScheduleParams): Promise<EmployeeScheduleEntity>;
}
export {};
