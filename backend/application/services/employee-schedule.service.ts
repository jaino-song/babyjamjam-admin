import { Injectable, Optional } from "@nestjs/common";
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
import { AlimtalkTriggerService } from "./alimtalk-trigger.service";
import { EmployeeFeedbackLinkService } from "./employee-feedback-link.service";

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
        @Optional() private readonly triggerService?: AlimtalkTriggerService,
        @Optional() private readonly employeeFeedbackLinkService?: EmployeeFeedbackLinkService,
    ) {}

    async create(branchid: string, params: {
        clientId: number;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
        workAddress: string;
        startDate: string;
        endDate: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        const schedule = await this.createEmployeeScheduleUsecase.execute(branchid, {
            clientId: params.clientId,
            primaryEmployeeId: params.primaryEmployeeId,
            secondaryEmployeeId: params.secondaryEmployeeId ?? null,
            workAddress: params.workAddress,
            startDate: new Date(params.startDate),
            endDate: new Date(params.endDate),
            replaced: params.replaced,
        });
        this.triggerService
            ?.syncEmployeeAssignmentRulesForSchedule(branchid, schedule.id, true)
            ?.catch(() => undefined);
        this.employeeFeedbackLinkService?.issueAndSend(schedule.id)?.catch(() => undefined);
        return schedule;
    }

    findAll(branchid: string): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesUsecase.execute(branchid);
    }

    findById(branchid: string, id: number): Promise<EmployeeScheduleEntity | null> {
        return this.findEmployeeScheduleByIdUsecase.execute(branchid, id);
    }

    findByPrimaryEmployeeId(
        branchid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesByPrimaryEmployeeIdUsecase.execute(
            branchid,
            primaryEmployeeId
        );
    }

    findBySecondaryEmployeeId(
        branchid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesBySecondaryEmployeeIdUsecase.execute(
            branchid,
            secondaryEmployeeId
        );
    }

    update(branchid: string, id: number, params: {
        workAddress?: string;
        startDate?: string;
        endDate?: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        return this.updateEmployeeScheduleUsecase.execute(branchid, id, {
            workAddress: params.workAddress,
            startDate: params.startDate ? new Date(params.startDate) : undefined,
            endDate: params.endDate ? new Date(params.endDate) : undefined,
            replaced: params.replaced,
        });
    }

    delete(branchid: string, id: number): Promise<void> {
        return this.deleteEmployeeScheduleUsecase.execute(branchid, id);
    }
}
