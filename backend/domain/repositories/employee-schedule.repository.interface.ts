import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

export interface IEmployeeScheduleRepository {
    findById(organizationid: string, id: number): Promise<EmployeeScheduleEntity | null>;
    findByClientId(organizationid: string, clientId: number): Promise<EmployeeScheduleEntity[]>;
    findByPrimaryEmployeeId(
        organizationid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]>;
    findBySecondaryEmployeeId(
        organizationid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]>;
    findAll(organizationid: string): Promise<EmployeeScheduleEntity[]>;
    create(organizationid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity>;
    update(organizationid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity>;
    delete(organizationid: string, id: number): Promise<void>;
}

export const EMPLOYEE_SCHEDULE_REPOSITORY = "EMPLOYEE_SCHEDULE_REPOSITORY";
