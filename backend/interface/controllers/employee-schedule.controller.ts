import { Body, Controller, Delete, Get, Query, Patch, Post } from "@nestjs/common";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { CreateEmployeeScheduleDto, UpdateEmployeeScheduleDto } from "interface/dto/employee-schedule.dto";

@Controller("employee-schedules")
export class EmployeeScheduleController {
    constructor(private readonly employeeScheduleService: EmployeeScheduleService) {}

    @Post()
    create(@Body() dto: CreateEmployeeScheduleDto) {
        return this.employeeScheduleService.create({
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
    findAll() {
        return this.employeeScheduleService.findAll();
    }

    @Get("primary-employee")
    findByPrimaryEmployee(@Query("primaryEmployeeId") primaryEmployeeId: string) {
        return this.employeeScheduleService.findByPrimaryEmployeeId(Number(primaryEmployeeId));
    }

    @Get("secondary-employee")
    findBySecondaryEmployee(@Query("secondaryEmployeeId") secondaryEmployeeId: string) {
        return this.employeeScheduleService.findBySecondaryEmployeeId(Number(secondaryEmployeeId));
    }

    @Get("id")
    findById(@Query("id") id: string) {
        return this.employeeScheduleService.findById(Number(id));
    }

    @Patch()
    update(@Query("id") id: string, @Body() dto: UpdateEmployeeScheduleDto) {
        return this.employeeScheduleService.update(Number(id), {
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }

    @Delete()
    delete(@Query("id") id: string) {
        return this.employeeScheduleService.delete(Number(id));
    }
}
