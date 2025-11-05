import { Body, Controller, Delete, Get, Query, Patch, Post } from "@nestjs/common";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { CreateEmployeeScheduleDto, UpdateEmployeeScheduleDto } from "interface/dto/employee-schedule.dto";

@Controller("employee-schedules")
export class EmployeeScheduleController {
    constructor(private readonly employeeScheduleService: EmployeeScheduleService) {}

    @Post()
    create(@Body() dto: CreateEmployeeScheduleDto) {
        return this.employeeScheduleService.create({
            employeeId: dto.employeeId,
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

    @Get("employee")
    findByEmployee(@Query("employeeId") employeeId: string) {
        return this.employeeScheduleService.findByEmployeeId(Number(employeeId));
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
