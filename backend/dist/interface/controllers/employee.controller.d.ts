import { EmployeeService } from "application/services/employee.service";
import { ChangeEmployeeOpenStatusDto, CreateEmployeeDto, EmployeesByRegisteredRangeDto, UpdateEmployeeDto } from "interface/dto/employee.dto";
export declare class EmployeeController {
    private readonly employeeService;
    constructor(employeeService: EmployeeService);
    create(dto: CreateEmployeeDto): Promise<import("../../domain/entities/employee.entity").EmployeeEntity>;
    findAll(): Promise<import("../../domain/entities/employee.entity").EmployeeEntity[]>;
    findById(id: string): Promise<import("../../domain/entities/employee.entity").EmployeeEntity>;
    update(id: string, dto: UpdateEmployeeDto): Promise<import("../../domain/entities/employee.entity").EmployeeEntity>;
    delete(id: string): Promise<void>;
    findByWorkArea(workArea: string): Promise<import("../../domain/entities/employee.entity").EmployeeEntity[]>;
    findByGrade(grade: string): Promise<import("../../domain/entities/employee.entity").EmployeeEntity[]>;
    findByOpenStatus(openToNextWork?: string): Promise<import("../../domain/entities/employee.entity").EmployeeEntity[]>;
    findByRegisteredDate(date: string): Promise<import("../../domain/entities/employee.entity").EmployeeEntity[]>;
    findByRegisteredDateRange(query: EmployeesByRegisteredRangeDto): Promise<import("../../domain/entities/employee.entity").EmployeeEntity[]>;
    changeOpenStatus(id: string, dto: ChangeEmployeeOpenStatusDto): Promise<import("../../domain/entities/employee.entity").EmployeeEntity>;
    findAllOpenToNextWork(): Promise<import("../../domain/entities/employee.entity").EmployeeEntity[]>;
}
