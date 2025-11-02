import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
type EmployeeScheduleRow = {
    id: number;
    employee_id: number;
    work_address: string;
    start_date: Date;
    end_date: Date;
    replaced: boolean;
};
export declare class EmployeeScheduleMapper {
    static toDomain(row: EmployeeScheduleRow): EmployeeScheduleEntity;
    static toPrismaCreate(entity: EmployeeScheduleEntity): {
        employee_id: number;
        work_address: string;
        start_date: Date;
        end_date: Date;
        replaced: boolean;
    };
    static toPrismaUpdate(entity: EmployeeScheduleEntity): {
        work_address: string;
        start_date: Date;
        end_date: Date;
        replaced: boolean;
    };
}
export {};
