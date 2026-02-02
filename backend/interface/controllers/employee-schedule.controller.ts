import { Body, Controller, Delete, Get, Query, Patch, Post } from "@nestjs/common";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { CreateEmployeeScheduleDto, UpdateEmployeeScheduleDto } from "interface/dto/employee-schedule.dto";
import { CurrentTenant } from "infrastructure/tenant";

@Controller("employee-schedules")
export class EmployeeScheduleController {
    constructor(private readonly employeeScheduleService: EmployeeScheduleService) {}

    @Post()
    create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateEmployeeScheduleDto) {
        return this.employeeScheduleService.create(tenant.organizationId ?? "", {
            clientId: dto.clientId,
            primaryEmployeeId: dto.primaryEmployeeId,
            secondaryEmployeeId: dto.secondaryEmployeeId ?? null,
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }

    @Get()
    findAll(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.employeeScheduleService.findAll(tenant.organizationId ?? "");
    }

    @Get("primary-employee")
    findByPrimaryEmployee(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("primaryEmployeeId") primaryEmployeeId: string
    ) {
        return this.employeeScheduleService.findByPrimaryEmployeeId(
            tenant.organizationId ?? "",
            Number(primaryEmployeeId)
        );
    }

    @Get("secondary-employee")
    findBySecondaryEmployee(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("secondaryEmployeeId") secondaryEmployeeId: string
    ) {
        return this.employeeScheduleService.findBySecondaryEmployeeId(
            tenant.organizationId ?? "",
            Number(secondaryEmployeeId)
        );
    }

    @Get("id")
    findById(@CurrentTenant() tenant: { organizationId?: string }, @Query("id") id: string) {
        return this.employeeScheduleService.findById(tenant.organizationId ?? "", Number(id));
    }

    @Patch()
    update(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("id") id: string,
        @Body() dto: UpdateEmployeeScheduleDto
    ) {
        return this.employeeScheduleService.update(tenant.organizationId ?? "", Number(id), {
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }

    @Delete()
    delete(@CurrentTenant() tenant: { organizationId?: string }, @Query("id") id: string) {
        return this.employeeScheduleService.delete(tenant.organizationId ?? "", Number(id));
    }
}
