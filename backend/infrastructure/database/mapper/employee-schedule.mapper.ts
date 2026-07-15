import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

type EmployeeScheduleRow = {
    id: number;
    clientId: number;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
};

export class EmployeeScheduleMapper {
    static toDomain(row: EmployeeScheduleRow): EmployeeScheduleEntity {
        return new EmployeeScheduleEntity(
            row.id,
            row.clientId,
            row.primaryEmployeeId,
            row.secondaryEmployeeId,
            row.workAddress,
            row.startDate,
            row.endDate,
            row.replaced,
        );
    }

    static toPrismaCreate(entity: EmployeeScheduleEntity) {
        return {
            clientId: entity.clientId,
            primaryEmployeeId: entity.primaryEmployeeId,
            secondaryEmployeeId: entity.secondaryEmployeeId,
            workAddress: entity.workAddress,
            startDate: entity.startDate,
            endDate: entity.endDate,
            replaced: entity.replaced,
        };
    }

    static toPrismaUpdate(entity: EmployeeScheduleEntity) {
        return {
            clientId: entity.clientId,
            primaryEmployeeId: entity.primaryEmployeeId,
            secondaryEmployeeId: entity.secondaryEmployeeId,
            workAddress: entity.workAddress,
            startDate: entity.startDate,
            endDate: entity.endDate,
            replaced: entity.replaced,
        };
    }
}
