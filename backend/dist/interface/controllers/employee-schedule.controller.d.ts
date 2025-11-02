import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { CreateEmployeeScheduleDto, UpdateEmployeeScheduleDto } from "interface/dto/employee-schedule.dto";
export declare class EmployeeScheduleController {
    private readonly employeeScheduleService;
    constructor(employeeScheduleService: EmployeeScheduleService);
    create(dto: CreateEmployeeScheduleDto): Promise<import("../../domain/entities/employee-schedule.entity").EmployeeScheduleEntity>;
    findAll(): Promise<import("../../domain/entities/employee-schedule.entity").EmployeeScheduleEntity[]>;
    findByEmployee(employeeId: string): Promise<import("../../domain/entities/employee-schedule.entity").EmployeeScheduleEntity[]>;
    findById(id: string): Promise<import("../../domain/entities/employee-schedule.entity").EmployeeScheduleEntity>;
    update(id: string, dto: UpdateEmployeeScheduleDto): Promise<import("../../domain/entities/employee-schedule.entity").EmployeeScheduleEntity>;
    delete(id: string): Promise<void>;
}
