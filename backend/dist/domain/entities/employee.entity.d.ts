export declare class EmployeeEntity {
    readonly id: number;
    name: string;
    workArea: string;
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: Date;
    constructor(id: number, name: string, workArea: string, phone: string, grade: string, openToNextWork: boolean, registeredDate: Date);
    isOpenToNextWork(): boolean;
    updateOpenToNextWork(openToNextWork: boolean): void;
    updateProfile(name?: string, workArea?: string, phone?: string, grade?: string, openToNextWork?: boolean): void;
    static create(name: string, workArea: string, phone: string, grade: string, openToNextWork: boolean, registeredDate?: Date): EmployeeEntity;
    static fromPrisma(prismaData: {
        id: number;
        name: string;
        workArea: string;
        phone: string;
        grade: string;
        openToNextWork: boolean;
        registeredDate: Date;
    }): EmployeeEntity;
    toPersistence(): {
        id: number;
        name: string;
        workArea: string;
        phone: string;
        grade: string;
        openToNextWork: boolean;
        registeredDate: Date;
    };
}
