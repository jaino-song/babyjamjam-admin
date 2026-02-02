import { EmployeeEntity } from "domain/entities/employee.entity";

export interface IEmployeeRepository {
    findById(organizationid: string, id: number): Promise<EmployeeEntity | null>;
    create(organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity>;
    update(organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity>;
    delete(organizationid: string, id: number): Promise<void>;
    findAll(organizationid: string): Promise<EmployeeEntity[]>;
    findByWorkArea(organizationid: string, workArea: string): Promise<EmployeeEntity[]>;
    findByGrade(organizationid: string, grade: string): Promise<EmployeeEntity[]>;
    findByOpenToNextWork(organizationid: string, openToNextWork: boolean): Promise<EmployeeEntity[]>;
    findByRegisteredDate(organizationid: string, registeredDate: Date): Promise<EmployeeEntity[]>;
    findByRegisteredDateRange(organizationid: string, startDate: Date, endDate: Date): Promise<EmployeeEntity[]>;
    changeOpenToNextWork(organizationid: string, id: number, openToNextWork: boolean): Promise<void>;
    findAllOpenToNextWork(organizationid: string): Promise<EmployeeEntity[]>;
}

export const EMPLOYEE_REPOSITORY = "EMPLOYEE_REPOSITORY";
