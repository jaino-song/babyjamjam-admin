export class EmployeeScheduleDateRangeError extends Error {
    constructor() {
        super("시작일은 종료일보다 늦을 수 없어요.");
        this.name = "EmployeeScheduleDateRangeError";
    }
}

export class EmployeeScheduleRoleError extends Error {
    constructor() {
        super("주담당과 부담당은 같은 직원일 수 없어요.");
        this.name = "EmployeeScheduleRoleError";
    }
}

export function assertEmployeeScheduleDateRange(startDate: Date, endDate: Date): void {
    if (
        !(startDate instanceof Date)
        || !(endDate instanceof Date)
        || Number.isNaN(startDate.getTime())
        || Number.isNaN(endDate.getTime())
        || startDate.getTime() > endDate.getTime()
    ) {
        throw new EmployeeScheduleDateRangeError();
    }
}

export function employeeScheduleDatesOverlap(
    leftStartDate: Date,
    leftEndDate: Date,
    rightStartDate: Date,
    rightEndDate: Date,
): boolean {
    return leftStartDate.getTime() <= rightEndDate.getTime()
        && leftEndDate.getTime() >= rightStartDate.getTime();
}

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
    ) {
        assertEmployeeScheduleDateRange(startDate, endDate);
        if (secondaryEmployeeId !== null && primaryEmployeeId === secondaryEmployeeId) {
            throw new EmployeeScheduleRoleError();
        }
    }

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
