import { Inject, Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { DEFAULT_EMPLOYEE_GRADE } from "domain/constants/employee-grade.constants";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import type { Prisma } from "@prisma/client";

@Injectable()
export class CreateEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    execute(
        branchid: string,
        name: string,
        workArea: string[] | undefined,
        phone: string,
        grade: string | undefined,
        openToNextWork: boolean | undefined,
        registeredDate?: Date,
        birthday?: string,
        transaction?: Prisma.TransactionClient,
        smsAutomationEnabled?: boolean,
    ): Promise<EmployeeEntity & { restored: boolean }> {
        const employee = EmployeeEntity.create(
            name,
            workArea ?? [],
            phone,
            grade ?? DEFAULT_EMPLOYEE_GRADE,
            openToNextWork ?? false,
            registeredDate,
            birthday,
            smsAutomationEnabled,
        );
        return this.employeeRepository.createOrRestore(branchid, employee, {
            name, workArea, phone, grade, openToNextWork, registeredDate, birthday, smsAutomationEnabled,
        }, transaction);
    }
}
