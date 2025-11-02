export declare class CreateEmployeeDto {
    name: string;
    workArea: string;
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: string;
}
export declare class UpdateEmployeeDto {
    name?: string;
    workArea?: string;
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
}
export declare class ChangeEmployeeOpenStatusDto {
    openToNextWork: boolean;
}
export declare class EmployeesByRegisteredRangeDto {
    startDate: string;
    endDate: string;
}
