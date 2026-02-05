import { Injectable } from "@nestjs/common";
import {
    ChangeEmployeeOpenStatusUsecase,
    CreateEmployeeUsecase,
    DeleteEmployeeUsecase,
    FindEmployeeByIdUsecase,
    ListEmployeesByGradeUsecase,
    ListEmployeesByOpenStatusUsecase,
    ListEmployeesByRegisteredDateRangeUsecase,
    ListEmployeesByRegisteredDateUsecase,
    ListEmployeesByWorkAreaUsecase,
    ListEmployeesOpenToNextWorkUsecase,
    ListEmployeesUsecase,
    UpdateEmployeeUsecase,
} from "application/usecases/employee";
import { EmployeeEntity } from "domain/entities/employee.entity";

export type EmployeeUpdateParams = {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
};

@Injectable()
export class EmployeeService {
    constructor(
        private readonly createEmployeeUsecase: CreateEmployeeUsecase,
        private readonly findEmployeeByIdUsecase: FindEmployeeByIdUsecase,
        private readonly updateEmployeeUsecase: UpdateEmployeeUsecase,
        private readonly deleteEmployeeUsecase: DeleteEmployeeUsecase,
        private readonly listEmployeesUsecase: ListEmployeesUsecase,
        private readonly listEmployeesByWorkAreaUsecase: ListEmployeesByWorkAreaUsecase,
        private readonly listEmployeesByGradeUsecase: ListEmployeesByGradeUsecase,
        private readonly listEmployeesByOpenStatusUsecase: ListEmployeesByOpenStatusUsecase,
        private readonly listEmployeesByRegisteredDateUsecase: ListEmployeesByRegisteredDateUsecase,
        private readonly listEmployeesByRegisteredDateRangeUsecase: ListEmployeesByRegisteredDateRangeUsecase,
        private readonly changeEmployeeOpenStatusUsecase: ChangeEmployeeOpenStatusUsecase,
        private readonly listEmployeesOpenToNextWorkUsecase: ListEmployeesOpenToNextWorkUsecase,
    ) {}

    create(
        organizationid: string,
        params: { name: string; workArea: string[]; phone: string; grade: string; openToNextWork: boolean; registeredDate?: string }
    ): Promise<EmployeeEntity> {
        return this.createEmployeeUsecase.execute(
            organizationid,
            params.name,
            params.workArea,
            params.phone,
            params.grade,
            params.openToNextWork,
            params.registeredDate ? new Date(params.registeredDate) : undefined,
        );
    }

    findById(organizationid: string, id: number): Promise<EmployeeEntity | null> {
        return this.findEmployeeByIdUsecase.execute(organizationid, id);
    }

    update(organizationid: string, id: number, params: EmployeeUpdateParams): Promise<EmployeeEntity> {
        return this.updateEmployeeUsecase.execute(organizationid, id, params);
    }

    delete(organizationid: string, id: number): Promise<void> {
        return this.deleteEmployeeUsecase.execute(organizationid, id);
    }

    findAll(organizationid: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesUsecase.execute(organizationid);
    }

    findByWorkArea(organizationid: string, workArea: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByWorkAreaUsecase.execute(organizationid, workArea);
    }

    findByGrade(organizationid: string, grade: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByGradeUsecase.execute(organizationid, grade);
    }

    findByOpenStatus(organizationid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        return this.listEmployeesByOpenStatusUsecase.execute(organizationid, openToNextWork);
    }

    findByRegisteredDate(organizationid: string, date: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateUsecase.execute(organizationid, date);
    }

    findByRegisteredDateRange(organizationid: string, start: Date, end: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateRangeUsecase.execute(organizationid, start, end);
    }

    changeOpenStatus(organizationid: string, id: number, open: boolean): Promise<EmployeeEntity> {
        return this.changeEmployeeOpenStatusUsecase.execute(organizationid, id, open);
    }

    findAllOpenToNextWork(organizationid: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesOpenToNextWorkUsecase.execute(organizationid);
    }
}
