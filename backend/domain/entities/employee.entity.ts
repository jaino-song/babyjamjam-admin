export class EmployeeEntity {
    constructor(
        public readonly id: number,
        public name: string,
        public workArea: string[],
        public phone: string,
        public grade: string,
        public openToNextWork: boolean,
        public registeredDate: Date,
    ) {}

    isOpenToNextWork(): boolean {
        return this.openToNextWork;
    }

    updateOpenToNextWork(openToNextWork: boolean): void {
        this.openToNextWork = openToNextWork;
    }

    updateProfile(
        name?: string,
        workArea?: string[],
        phone?: string,
        grade?: string,
        openToNextWork?: boolean,
    ): void {
        this.name = name ?? this.name;
        this.workArea = workArea ?? this.workArea;
        this.phone = phone ?? this.phone;
        this.grade = grade ?? this.grade;
        this.openToNextWork = openToNextWork ?? this.openToNextWork;
    }

    static create(
        name: string,
        workArea: string[],
        phone: string,
        grade: string,
        openToNextWork: boolean,
        registeredDate?: Date,
    ): EmployeeEntity {
        return new EmployeeEntity(
            0,
            name,
            workArea,
            phone,
            grade,
            openToNextWork,
            registeredDate ?? new Date(),
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: number,
        name: string,
        workArea: string[],
        phone: string,
        grade: string,
        openToNextWork: boolean,
        registeredDate: Date,
    ): EmployeeEntity {
        return new EmployeeEntity(
            id,
            name,
            workArea,
            phone,
            grade,
            openToNextWork,
            registeredDate,
        );
    }
}