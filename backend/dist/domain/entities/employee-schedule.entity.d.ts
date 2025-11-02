export declare class EmployeeScheduleEntity {
    readonly id: number;
    readonly employeeId: number;
    readonly workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    constructor(id: number, employeeId: number, workAddress: string, startDate: Date, endDate: Date, replaced?: boolean);
    static create(employeeId: number, workAddress: string, startDate: Date, endDate: Date, replaced?: boolean): EmployeeScheduleEntity;
}
