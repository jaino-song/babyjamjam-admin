"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeEntity = void 0;
class EmployeeEntity {
    constructor(id, name, workArea, phone, grade, openToNextWork, registeredDate) {
        this.id = id;
        this.name = name;
        this.workArea = workArea;
        this.phone = phone;
        this.grade = grade;
        this.openToNextWork = openToNextWork;
        this.registeredDate = registeredDate;
    }
    isOpenToNextWork() {
        return this.openToNextWork;
    }
    updateOpenToNextWork(openToNextWork) {
        this.openToNextWork = openToNextWork;
    }
    updateProfile(name, workArea, phone, grade, openToNextWork) {
        this.name = name ?? this.name;
        this.workArea = workArea ?? this.workArea;
        this.phone = phone ?? this.phone;
        this.grade = grade ?? this.grade;
        this.openToNextWork = openToNextWork ?? this.openToNextWork;
    }
    static create(name, workArea, phone, grade, openToNextWork, registeredDate) {
        return new EmployeeEntity(0, name, workArea, phone, grade, openToNextWork, registeredDate ?? new Date());
    }
    static fromPrisma(prismaData) {
        return new EmployeeEntity(prismaData.id, prismaData.name, prismaData.workArea, prismaData.phone, prismaData.grade, prismaData.openToNextWork, prismaData.registeredDate);
    }
    toPersistence() {
        return {
            id: this.id,
            name: this.name,
            workArea: this.workArea,
            phone: this.phone,
            grade: this.grade,
            openToNextWork: this.openToNextWork,
            registeredDate: this.registeredDate,
        };
    }
}
exports.EmployeeEntity = EmployeeEntity;
//# sourceMappingURL=employee.entity.js.map