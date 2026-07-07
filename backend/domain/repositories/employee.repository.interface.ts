import { EmployeeEntity } from "domain/entities/employee.entity";

export interface IEmployeeRepository {
    findById(branchid: string, id: number): Promise<EmployeeEntity | null>;
    findByPhone(branchid: string, normalizedPhone: string): Promise<EmployeeEntity | null>;
    create(branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity>;
    update(branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity>;
    delete(branchid: string, id: number): Promise<void>;
    findAll(branchid: string): Promise<EmployeeEntity[]>;
    findByWorkArea(branchid: string, workArea: string): Promise<EmployeeEntity[]>;
    findByGrade(branchid: string, grade: string): Promise<EmployeeEntity[]>;
    findByOpenToNextWork(branchid: string, openToNextWork: boolean): Promise<EmployeeEntity[]>;
    findByRegisteredDate(branchid: string, registeredDate: Date): Promise<EmployeeEntity[]>;
    findByRegisteredDateRange(branchid: string, startDate: Date, endDate: Date): Promise<EmployeeEntity[]>;
    changeOpenToNextWork(branchid: string, id: number, openToNextWork: boolean): Promise<void>;
    findAllOpenToNextWork(branchid: string): Promise<EmployeeEntity[]>;
}

export const EMPLOYEE_REPOSITORY = "EMPLOYEE_REPOSITORY";
