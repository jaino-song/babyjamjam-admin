import { EmployeeEntity } from "domain/entities/employee.entity";
import { normalizeEmployeeGrade } from "domain/constants/employee-grade.constants";

type EmployeeRow = {
    id: number;
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    companyRegisteredDate: Date | null;
};

export class EmployeeMapper {
    static toDomain(row: EmployeeRow): EmployeeEntity {
        return new EmployeeEntity(
            row.id,
            row.name,
            row.workArea,
            row.phone,
            normalizeEmployeeGrade(row.grade),
            row.openToNextWork,
            row.companyRegisteredDate ?? new Date(),
        );
    }

    static toPrismaCreate(entity: EmployeeEntity) {
        return {
            id: entity.id,
            name: entity.name,
            workArea: entity.workArea,
            phone: entity.phone,
            grade: normalizeEmployeeGrade(entity.grade),
            openToNextWork: entity.openToNextWork,
            companyRegisteredDate: entity.registeredDate,
        };
    }

    static toPrismaUpdate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            workArea: entity.workArea,
            phone: entity.phone,
            grade: normalizeEmployeeGrade(entity.grade),
            openToNextWork: entity.openToNextWork,
        };
    }
}

