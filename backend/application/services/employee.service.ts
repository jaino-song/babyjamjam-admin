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
import { normalizeEmployeeGrade } from "domain/constants/employee-grade.constants";
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
        branchid: string,
        params: { name: string; workArea: string[]; phone: string; grade: string; openToNextWork: boolean; registeredDate?: string }
    ): Promise<EmployeeEntity> {
        return this.createEmployeeUsecase.execute(
            branchid,
            params.name,
            params.workArea,
            params.phone,
            normalizeEmployeeGrade(params.grade),
            params.openToNextWork,
            params.registeredDate ? new Date(params.registeredDate) : undefined,
        );
    }

    findById(branchid: string, id: number): Promise<EmployeeEntity | null> {
        return this.findEmployeeByIdUsecase.execute(branchid, id);
    }

    update(branchid: string, id: number, params: EmployeeUpdateParams): Promise<EmployeeEntity> {
        return this.updateEmployeeUsecase.execute(branchid, id, {
            ...params,
            grade: params.grade === undefined ? undefined : normalizeEmployeeGrade(params.grade),
        });
    }

    delete(branchid: string, id: number): Promise<void> {
        return this.deleteEmployeeUsecase.execute(branchid, id);
    }

    findAll(branchid: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesUsecase.execute(branchid);
    }

    findByWorkArea(branchid: string, workArea: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByWorkAreaUsecase.execute(branchid, workArea);
    }

    findByGrade(branchid: string, grade: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByGradeUsecase.execute(branchid, normalizeEmployeeGrade(grade));
    }

    findByOpenStatus(branchid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        return this.listEmployeesByOpenStatusUsecase.execute(branchid, openToNextWork);
    }

    findByRegisteredDate(branchid: string, date: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateUsecase.execute(branchid, date);
    }

    findByRegisteredDateRange(branchid: string, start: Date, end: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateRangeUsecase.execute(branchid, start, end);
    }

    changeOpenStatus(branchid: string, id: number, open: boolean): Promise<EmployeeEntity> {
        return this.changeEmployeeOpenStatusUsecase.execute(branchid, id, open);
    }

    findAllOpenToNextWork(branchid: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesOpenToNextWorkUsecase.execute(branchid);
    }
}
