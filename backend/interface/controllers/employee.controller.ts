import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { EmployeeService } from "application/services/employee.service";
import {
    ChangeEmployeeOpenStatusDto,
    CreateEmployeeDto,
    EmployeesByRegisteredRangeDto,
    UpdateEmployeeDto,
} from "interface/dto/employee.dto";
import { CurrentTenant } from "infrastructure/tenant";

@Controller("employees")
export class EmployeeController {
    constructor(private readonly employeeService: EmployeeService) {}

    @Post()
    create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateEmployeeDto) {
        return this.employeeService.create(tenant.organizationId ?? "", dto);
    }

    @Get()
    findAll(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.employeeService.findAll(tenant.organizationId ?? "");
    }

    @Get("work-area")
    findByWorkArea(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("workArea") workArea: string
    ) {
        return this.employeeService.findByWorkArea(tenant.organizationId ?? "", workArea);
    }

    @Get("grade")
    findByGrade(@CurrentTenant() tenant: { organizationId?: string }, @Query("grade") grade: string) {
        return this.employeeService.findByGrade(tenant.organizationId ?? "", grade);
    }

    @Get("open-status")
    findByOpenStatus(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("openToNextWork") openToNextWork?: string
    ) {
        const flag = openToNextWork === undefined ? true : openToNextWork === "true";
        return this.employeeService.findByOpenStatus(tenant.organizationId ?? "", flag);
    }

    @Get("registered-date")
    findByRegisteredDate(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("date") date: string
    ) {
        return this.employeeService.findByRegisteredDate(tenant.organizationId ?? "", new Date(date));
    }

    @Get("registered-range")
    findByRegisteredDateRange(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query() query: EmployeesByRegisteredRangeDto
    ) {
        return this.employeeService.findByRegisteredDateRange(
            tenant.organizationId ?? "",
            new Date(query.startDate),
            new Date(query.endDate)
        );
    }

    @Get("open-to-next-work")
    findAllOpenToNextWork(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.employeeService.findAllOpenToNextWork(tenant.organizationId ?? "");
    }

    @Get("id")
    findById(@CurrentTenant() tenant: { organizationId?: string }, @Query("id") id: string) {
        return this.employeeService.findById(tenant.organizationId ?? "", Number(id));
    }

    @Patch("open-status")
    changeOpenStatus(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("id") id: string,
        @Body() dto: ChangeEmployeeOpenStatusDto
    ) {
        return this.employeeService.changeOpenStatus(
            tenant.organizationId ?? "",
            Number(id),
            dto.openToNextWork
        );
    }

    @Patch()
    update(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("id") id: string,
        @Body() dto: UpdateEmployeeDto
    ) {
        return this.employeeService.update(tenant.organizationId ?? "", Number(id), dto);
    }

    @Delete()
    delete(@CurrentTenant() tenant: { organizationId?: string }, @Query("id") id: string) {
        return this.employeeService.delete(tenant.organizationId ?? "", Number(id));
    }
}
