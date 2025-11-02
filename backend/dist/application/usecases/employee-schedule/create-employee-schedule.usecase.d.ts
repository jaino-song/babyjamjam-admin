import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
type CreateEmployeeScheduleParams = {
    employeeId: number;
    workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced?: boolean;
};
export declare class CreateEmployeeScheduleUsecase {
    private readonly employeeScheduleRepository;
    constructor(employeeScheduleRepository: IEmployeeScheduleRepository);
    execute(params: CreateEmployeeScheduleParams): Promise<EmployeeScheduleEntity>;
}
export {};
