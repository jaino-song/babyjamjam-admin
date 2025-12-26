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

    create(params: {
        clientId: number;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
        workAddress: string;
        startDate: string;
        endDate: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        return this.createEmployeeScheduleUsecase.execute({
            clientId: params.clientId,
            primaryEmployeeId: params.primaryEmployeeId,
            secondaryEmployeeId: params.secondaryEmployeeId ?? null,
            workAddress: params.workAddress,
            startDate: new Date(params.startDate),
            endDate: new Date(params.endDate),
            replaced: params.replaced,
        });
    }

    findAll(): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesUsecase.execute();
    }

    findById(id: number): Promise<EmployeeScheduleEntity | null> {
        return this.findEmployeeScheduleByIdUsecase.execute(id);
    }

    findByPrimaryEmployeeId(primaryEmployeeId: number): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesByPrimaryEmployeeIdUsecase.execute(primaryEmployeeId);
    }

    findBySecondaryEmployeeId(secondaryEmployeeId: number): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesBySecondaryEmployeeIdUsecase.execute(secondaryEmployeeId);
    }

    update(id: number, params: {
        workAddress?: string;
        startDate?: string;
        endDate?: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        return this.updateEmployeeScheduleUsecase.execute(id, {
            workAddress: params.workAddress,
            startDate: params.startDate ? new Date(params.startDate) : undefined,
            endDate: params.endDate ? new Date(params.endDate) : undefined,
            replaced: params.replaced,
        });
    }

    delete(id: number): Promise<void> {
        return this.deleteEmployeeScheduleUsecase.execute(id);
    }
}
