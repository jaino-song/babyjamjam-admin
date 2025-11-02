export declare class CreateEmployeeScheduleDto {
    employeeId: number;
    workAddress: string;
    startDate: string;
    endDate: string;
    replaced?: boolean;
}
export declare class UpdateEmployeeScheduleDto {
    workAddress?: string;
    startDate?: string;
    endDate?: string;
    replaced?: boolean;
}
