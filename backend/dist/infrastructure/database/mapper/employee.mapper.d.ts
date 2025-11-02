import { EmployeeEntity } from "domain/entities/employee.entity";
type EmployeeRow = {
    id: number;
    name: string;
    work_area: string;
    phone: string;
    grade: string;
    open_to_next_work: boolean;
    company_registered_date: Date | null;
};
export declare class EmployeeMapper {
    static toDomain(row: EmployeeRow): EmployeeEntity;
    static toPrismaCreate(entity: EmployeeEntity): {
        id: number;
        name: string;
        work_area: string;
        phone: string;
        grade: string;
        open_to_next_work: boolean;
        company_registered_date: Date;
    };
    static toPrismaUpdate(entity: EmployeeEntity): {
        name: string;
        work_area: string;
        phone: string;
        grade: string;
        open_to_next_work: boolean;
    };
}
export {};
