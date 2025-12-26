import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

type EmployeeScheduleRow = {
    id: number;
    client_id: number;
    primary_employee_id: number;
    secondary_employee_id: number | null;
    work_address: string;
    start_date: Date;
    end_date: Date;
    replaced: boolean;
};

export class EmployeeScheduleMapper {
    static toDomain(row: EmployeeScheduleRow): EmployeeScheduleEntity {
        return new EmployeeScheduleEntity(
            row.id,
            row.client_id,
            row.primary_employee_id,
            row.secondary_employee_id,
            row.work_address,
            row.start_date,
            row.end_date,
            row.replaced,
        );
    }

    static toPrismaCreate(entity: EmployeeScheduleEntity) {
        return {
            client_id: entity.clientId,
            primary_employee_id: entity.primaryEmployeeId,
            secondary_employee_id: entity.secondaryEmployeeId,
            work_address: entity.workAddress,
            start_date: entity.startDate,
            end_date: entity.endDate,
            replaced: entity.replaced,
        };
    }

    static toPrismaUpdate(entity: EmployeeScheduleEntity) {
        return {
            client_id: entity.clientId,
            primary_employee_id: entity.primaryEmployeeId,
            secondary_employee_id: entity.secondaryEmployeeId,
            work_address: entity.workAddress,
            start_date: entity.startDate,
            end_date: entity.endDate,
            replaced: entity.replaced,
        };
    }
}
