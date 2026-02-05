import { Injectable } from "@nestjs/common";
import {
    CreateEmployeeScheduleUsecase,
    DeleteEmployeeScheduleUsecase,
    FindEmployeeScheduleByIdUsecase,
    ListEmployeeSchedulesByPrimaryEmployeeIdUsecase,
    ListEmployeeSchedulesBySecondaryEmployeeIdUsecase,
    ListEmployeeSchedulesUsecase,
    UpdateEmployeeScheduleUsecase,
} from "application/usecases/employee-schedule";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

@Injectable()
export class EmployeeScheduleService {
    constructor(
        private readonly createEmployeeScheduleUsecase: CreateEmployeeScheduleUsecase,
        private readonly findEmployeeScheduleByIdUsecase: FindEmployeeScheduleByIdUsecase,
        private readonly listEmployeeSchedulesUsecase: ListEmployeeSchedulesUsecase,
        private readonly listEmployeeSchedulesByPrimaryEmployeeIdUsecase: ListEmployeeSchedulesByPrimaryEmployeeIdUsecase,
        private readonly listEmployeeSchedulesBySecondaryEmployeeIdUsecase: ListEmployeeSchedulesBySecondaryEmployeeIdUsecase,
        private readonly updateEmployeeScheduleUsecase: UpdateEmployeeScheduleUsecase,
        private readonly deleteEmployeeScheduleUsecase: DeleteEmployeeScheduleUsecase,
    ) {}

    create(organizationid: string, params: {
        clientId: number;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
        workAddress: string;
        startDate: string;
        endDate: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        return this.createEmployeeScheduleUsecase.execute(organizationid, {
            clientId: params.clientId,
            primaryEmployeeId: params.primaryEmployeeId,
            secondaryEmployeeId: params.secondaryEmployeeId ?? null,
            workAddress: params.workAddress,
            startDate: new Date(params.startDate),
            endDate: new Date(params.endDate),
            replaced: params.replaced,
        });
    }

    findAll(organizationid: string): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesUsecase.execute(organizationid);
    }

    findById(organizationid: string, id: number): Promise<EmployeeScheduleEntity | null> {
        return this.findEmployeeScheduleByIdUsecase.execute(organizationid, id);
    }

    findByPrimaryEmployeeId(
        organizationid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesByPrimaryEmployeeIdUsecase.execute(
            organizationid,
            primaryEmployeeId
        );
    }

    findBySecondaryEmployeeId(
        organizationid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesBySecondaryEmployeeIdUsecase.execute(
            organizationid,
            secondaryEmployeeId
        );
    }

    update(organizationid: string, id: number, params: {
        workAddress?: string;
        startDate?: string;
        endDate?: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        return this.updateEmployeeScheduleUsecase.execute(organizationid, id, {
            workAddress: params.workAddress,
            startDate: params.startDate ? new Date(params.startDate) : undefined,
            endDate: params.endDate ? new Date(params.endDate) : undefined,
            replaced: params.replaced,
        });
    }

    delete(organizationid: string, id: number): Promise<void> {
        return this.deleteEmployeeScheduleUsecase.execute(organizationid, id);
    }
}
