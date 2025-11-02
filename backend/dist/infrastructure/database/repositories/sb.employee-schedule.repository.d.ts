import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
export declare class SbEmployeeScheduleRepository implements IEmployeeScheduleRepository {
    private readonly prismaService;
    constructor(prismaService: PrismaService);
    findById(id: number): Promise<EmployeeScheduleEntity | null>;
    findByEmployeeId(employeeId: number): Promise<EmployeeScheduleEntity[]>;
    findAll(): Promise<EmployeeScheduleEntity[]>;
    create(schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity>;
    update(schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity>;
    delete(id: number): Promise<void>;
}
