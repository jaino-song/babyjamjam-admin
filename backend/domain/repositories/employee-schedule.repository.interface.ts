import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

export interface IEmployeeScheduleRepository {
    findById(id: number): Promise<EmployeeScheduleEntity | null>;
    findByClientId(clientId: number): Promise<EmployeeScheduleEntity[]>;
    findByPrimaryEmployeeId(primaryEmployeeId: number): Promise<EmployeeScheduleEntity[]>;
    findBySecondaryEmployeeId(secondaryEmployeeId: number): Promise<EmployeeScheduleEntity[]>;
    findAll(): Promise<EmployeeScheduleEntity[]>;
    create(schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity>;
    update(schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity>;
    delete(id: number): Promise<void>;
}

export const EMPLOYEE_SCHEDULE_REPOSITORY = "EMPLOYEE_SCHEDULE_REPOSITORY";
