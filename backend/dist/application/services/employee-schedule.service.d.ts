import { CreateEmployeeScheduleUsecase, DeleteEmployeeScheduleUsecase, FindEmployeeScheduleByIdUsecase, ListEmployeeSchedulesByEmployeeIdUsecase, ListEmployeeSchedulesUsecase, UpdateEmployeeScheduleUsecase } from "application/usecases/employee-schedule";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
export declare class EmployeeScheduleService {
    private readonly createEmployeeScheduleUsecase;
    private readonly findEmployeeScheduleByIdUsecase;
    private readonly listEmployeeSchedulesUsecase;
    private readonly listEmployeeSchedulesByEmployeeIdUsecase;
    private readonly updateEmployeeScheduleUsecase;
    private readonly deleteEmployeeScheduleUsecase;
    constructor(createEmployeeScheduleUsecase: CreateEmployeeScheduleUsecase, findEmployeeScheduleByIdUsecase: FindEmployeeScheduleByIdUsecase, listEmployeeSchedulesUsecase: ListEmployeeSchedulesUsecase, listEmployeeSchedulesByEmployeeIdUsecase: ListEmployeeSchedulesByEmployeeIdUsecase, updateEmployeeScheduleUsecase: UpdateEmployeeScheduleUsecase, deleteEmployeeScheduleUsecase: DeleteEmployeeScheduleUsecase);
    create(params: {
        employeeId: number;
        workAddress: string;
        startDate: string;
        endDate: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity>;
    findAll(): Promise<EmployeeScheduleEntity[]>;
    findById(id: number): Promise<EmployeeScheduleEntity | null>;
    findByEmployeeId(employeeId: number): Promise<EmployeeScheduleEntity[]>;
    update(id: number, params: {
        workAddress?: string;
        startDate?: string;
        endDate?: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity>;
    delete(id: number): Promise<void>;
}
