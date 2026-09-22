import {
    EmployeeScheduleDateRangeError,
    EmployeeScheduleEntity,
    EmployeeScheduleRoleError,
} from "domain/entities/employee-schedule.entity";

const validDates = {
    start: new Date("2026-08-01T00:00:00.000Z"),
    end: new Date("2026-08-31T00:00:00.000Z"),
};

describe("EmployeeScheduleEntity invariants", () => {
    it("rejects an inverted date range with Korean user-facing copy", () => {
        expect(() => new EmployeeScheduleEntity(
            1,
            10,
            20,
            null,
            "서울",
            validDates.end,
            validDates.start,
        )).toThrow(EmployeeScheduleDateRangeError);
        expect(() => new EmployeeScheduleEntity(
            1,
            10,
            20,
            null,
            "서울",
            validDates.end,
            validDates.start,
        )).toThrow("시작일은 종료일보다 늦을 수 없어요.");
    });

    it("allows an equal one-day range", () => {
        const date = new Date("2026-08-01T00:00:00.000Z");
        expect(() => new EmployeeScheduleEntity(1, 10, 20, null, "서울", date, date)).not.toThrow();
    });

    it("rejects assigning one employee to both roles with Korean user-facing copy", () => {
        expect(() => new EmployeeScheduleEntity(
            1,
            10,
            20,
            20,
            "서울",
            validDates.start,
            validDates.end,
        )).toThrow(EmployeeScheduleRoleError);
        expect(() => new EmployeeScheduleEntity(
            1,
            10,
            20,
            20,
            "서울",
            validDates.start,
            validDates.end,
        )).toThrow("주담당과 부담당은 같은 직원일 수 없어요.");
    });
});
