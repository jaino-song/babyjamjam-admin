import { Injectable, Logger, Optional } from "@nestjs/common";
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
import { MessageTriggerService } from "./message-trigger.service";
import { ServiceRecordLinkService } from "./service-record-link.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";

@Injectable()
export class EmployeeScheduleService {
    private readonly logger = new Logger(EmployeeScheduleService.name);

    constructor(
        private readonly createEmployeeScheduleUsecase: CreateEmployeeScheduleUsecase,
        private readonly findEmployeeScheduleByIdUsecase: FindEmployeeScheduleByIdUsecase,
        private readonly listEmployeeSchedulesUsecase: ListEmployeeSchedulesUsecase,
        private readonly listEmployeeSchedulesByPrimaryEmployeeIdUsecase: ListEmployeeSchedulesByPrimaryEmployeeIdUsecase,
        private readonly listEmployeeSchedulesBySecondaryEmployeeIdUsecase: ListEmployeeSchedulesBySecondaryEmployeeIdUsecase,
        private readonly updateEmployeeScheduleUsecase: UpdateEmployeeScheduleUsecase,
        private readonly deleteEmployeeScheduleUsecase: DeleteEmployeeScheduleUsecase,
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly serviceRecordLinkService?: ServiceRecordLinkService,
        @Optional() private readonly serviceRecordLifecycleService?: ServiceRecordLifecycleService,
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
        await this.serviceRecordLifecycleService?.ensureForClient(schedule.clientId);
        this.serviceRecordLinkService?.scheduleForServiceStart(schedule.id)?.catch(() => undefined);
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

    async update(branchid: string, id: number, params: {
        workAddress?: string;
        startDate?: string;
        endDate?: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        const schedule = await this.updateEmployeeScheduleUsecase.execute(branchid, id, {
            workAddress: params.workAddress,
            startDate: params.startDate ? new Date(params.startDate) : undefined,
            endDate: params.endDate ? new Date(params.endDate) : undefined,
            replaced: params.replaced,
        });
        await this.serviceRecordLifecycleService?.ensureForClient(schedule.clientId);
        if (params.endDate) {
            this.serviceRecordLinkService
                ?.extendExpiryForEndDate(schedule.id, schedule.endDate)
                ?.catch((error) => {
                    this.logger.error(
                        `[SERVICE_RECORD_LINK_EXTEND_FAILED] scheduleId=${schedule.id} — 수동 확인 필요`,
                        error instanceof Error ? error.stack : String(error),
                    );
                });
        }
        return schedule;
    }

    async delete(branchid: string, id: number): Promise<void> {
        const schedule = await this.findEmployeeScheduleByIdUsecase.execute(branchid, id);
        await this.deleteEmployeeScheduleUsecase.execute(branchid, id);
        if (schedule) {
            await this.serviceRecordLifecycleService?.ensureForClient(schedule.clientId);
        }
    }
}
