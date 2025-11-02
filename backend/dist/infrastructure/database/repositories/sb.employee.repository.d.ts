import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
export declare class SbEmployeeRepository implements IEmployeeRepository {
    private readonly prismaService;
    constructor(prismaService: PrismaService);
    findById(id: number): Promise<EmployeeEntity | null>;
    create(employee: EmployeeEntity): Promise<EmployeeEntity>;
    update(employee: EmployeeEntity): Promise<EmployeeEntity>;
    delete(id: number): Promise<void>;
    findAll(): Promise<EmployeeEntity[]>;
    findByWorkArea(workArea: string): Promise<EmployeeEntity[]>;
    findByGrade(grade: string): Promise<EmployeeEntity[]>;
    findByOpenToNextWork(openToNextWork: boolean): Promise<EmployeeEntity[]>;
    findByRegisteredDate(registeredDate: Date): Promise<EmployeeEntity[]>;
    findByRegisteredDateRange(startDate: Date, endDate: Date): Promise<EmployeeEntity[]>;
    changeOpenToNextWork(id: number, openToNextWork: boolean): Promise<void>;
    findAllOpenToNextWork(): Promise<EmployeeEntity[]>;
}
