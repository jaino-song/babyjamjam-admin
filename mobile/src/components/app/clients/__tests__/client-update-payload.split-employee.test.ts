import type { UpdateClientDto } from "@/lib/client/types";

import { splitEmployeeChangeFromStartDateChange } from "../client-update-payload";

const period: UpdateClientDto = {
    startDate: "2026-11-03",
    endDate: "2026-11-16",
    duration: 10,
    expectedEndDate: "2026-11-13",
    startDateChangeMode: "MOVE",
};

describe("splitEmployeeChangeFromStartDateChange", () => {
    it.each<UpdateClientDto>([
        { primaryEmployeeId: 42 },
        { secondaryEmployeeId: null },
        { primaryEmployeeId: 42, secondaryEmployeeId: null },
        { primaryEmployeeId: undefined },
    ])("separates only the employee own properties: %j", (employeeDto) => {
        const dto = Object.freeze({ ...period, ...employeeDto });
        expect(splitEmployeeChangeFromStartDateChange(dto)).toEqual({
            startDateDto: period,
            employeeDto,
        });
        expect(dto).toEqual({ ...period, ...employeeDto });
    });

    it("returns null without employee keys and copies the input", () => {
        const dto = Object.freeze({ ...period });
        const result = splitEmployeeChangeFromStartDateChange(dto);
        expect(result).toEqual({ startDateDto: period, employeeDto: null });
        expect(result.startDateDto).not.toBe(dto);
        expect(dto).toEqual(period);
    });

    it("does not treat inherited employee keys as changes", () => {
        const dto: UpdateClientDto = Object.assign(
            Object.create({ primaryEmployeeId: 42, secondaryEmployeeId: null }), period,
        );
        expect(splitEmployeeChangeFromStartDateChange(dto)).toEqual({ startDateDto: period, employeeDto: null });
    });
});
