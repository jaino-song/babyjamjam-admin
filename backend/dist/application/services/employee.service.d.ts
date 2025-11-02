import { ChangeEmployeeOpenStatusUsecase, CreateEmployeeUsecase, DeleteEmployeeUsecase, FindEmployeeByIdUsecase, ListEmployeesByGradeUsecase, ListEmployeesByOpenStatusUsecase, ListEmployeesByRegisteredDateRangeUsecase, ListEmployeesByRegisteredDateUsecase, ListEmployeesByWorkAreaUsecase, ListEmployeesOpenToNextWorkUsecase, ListEmployeesUsecase, UpdateEmployeeUsecase } from "application/usecases/employee";
import { EmployeeEntity } from "domain/entities/employee.entity";
export type EmployeeUpdateParams = {
    name?: string;
    workArea?: string;
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
};
export declare class EmployeeService {
    private readonly createEmployeeUsecase;
    private readonly findEmployeeByIdUsecase;
    private readonly updateEmployeeUsecase;
    private readonly deleteEmployeeUsecase;
    private readonly listEmployeesUsecase;
    private readonly listEmployeesByWorkAreaUsecase;
    private readonly listEmployeesByGradeUsecase;
    private readonly listEmployeesByOpenStatusUsecase;
    private readonly listEmployeesByRegisteredDateUsecase;
    private readonly listEmployeesByRegisteredDateRangeUsecase;
    private readonly changeEmployeeOpenStatusUsecase;
    private readonly listEmployeesOpenToNextWorkUsecase;
    constructor(createEmployeeUsecase: CreateEmployeeUsecase, findEmployeeByIdUsecase: FindEmployeeByIdUsecase, updateEmployeeUsecase: UpdateEmployeeUsecase, deleteEmployeeUsecase: DeleteEmployeeUsecase, listEmployeesUsecase: ListEmployeesUsecase, listEmployeesByWorkAreaUsecase: ListEmployeesByWorkAreaUsecase, listEmployeesByGradeUsecase: ListEmployeesByGradeUsecase, listEmployeesByOpenStatusUsecase: ListEmployeesByOpenStatusUsecase, listEmployeesByRegisteredDateUsecase: ListEmployeesByRegisteredDateUsecase, listEmployeesByRegisteredDateRangeUsecase: ListEmployeesByRegisteredDateRangeUsecase, changeEmployeeOpenStatusUsecase: ChangeEmployeeOpenStatusUsecase, listEmployeesOpenToNextWorkUsecase: ListEmployeesOpenToNextWorkUsecase);
    create(params: {
        name: string;
        workArea: string;
        phone: string;
        grade: string;
        openToNextWork: boolean;
        registeredDate?: string;
    }): Promise<EmployeeEntity>;
    findById(id: number): Promise<EmployeeEntity | null>;
    update(id: number, params: EmployeeUpdateParams): Promise<EmployeeEntity>;
    delete(id: number): Promise<void>;
    findAll(): Promise<EmployeeEntity[]>;
    findByWorkArea(workArea: string): Promise<EmployeeEntity[]>;
    findByGrade(grade: string): Promise<EmployeeEntity[]>;
    findByOpenStatus(openToNextWork: boolean): Promise<EmployeeEntity[]>;
    findByRegisteredDate(date: Date): Promise<EmployeeEntity[]>;
    findByRegisteredDateRange(start: Date, end: Date): Promise<EmployeeEntity[]>;
    changeOpenStatus(id: number, open: boolean): Promise<EmployeeEntity>;
    findAllOpenToNextWork(): Promise<EmployeeEntity[]>;
}
