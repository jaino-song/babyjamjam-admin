// Employee entity types

export type EmployeeStatus = 'available' | 'working' | 'unavailable';

export interface Employee {
    id: number;
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: string;
    status: EmployeeStatus;
}

export interface CreateEmployeeDto {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
}

export interface UpdateEmployeeDto {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
}

// Grade options
export const GRADE_OPTIONS = [
    { value: 'basic', label: '일반' },
    { value: 'senior', label: '시니어' },
    { value: 'manager', label: '관리자' },
] as const;

export type Grade = typeof GRADE_OPTIONS[number]['value'];
