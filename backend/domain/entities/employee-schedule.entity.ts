export class EmployeeScheduleEntity {
    constructor(
        public readonly id: number,
        public readonly clientId: number,
        public readonly primaryEmployeeId: number,
        public readonly secondaryEmployeeId: number | null,
        public readonly workAddress: string,
        public startDate: Date,
        public endDate: Date,
        public replaced: boolean = false,
    ) {}

    static create(
        clientId: number,
        primaryEmployeeId: number,
        secondaryEmployeeId: number | null,
        workAddress: string,
        startDate: Date,
        endDate: Date,
        replaced = false,
    ): EmployeeScheduleEntity {
        return new EmployeeScheduleEntity(0, clientId, primaryEmployeeId, secondaryEmployeeId, workAddress, startDate, endDate, replaced);
    }
}
