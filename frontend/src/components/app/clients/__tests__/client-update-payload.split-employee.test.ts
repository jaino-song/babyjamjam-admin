import type { UpdateClientDto } from "@/features/clients/types";

import { splitEmployeeChangeFromStartDateChange } from "../client-update-payload";

describe("splitEmployeeChangeFromStartDateChange", () => {
  const period: UpdateClientDto = {
    startDate: "2026-08-27", endDate: "2026-09-14", duration: 15,
    expectedEndDate: "2026-09-14", startDateChangeMode: "MOVE",
  };

  it.each([
    { primaryEmployeeId: 99 },
    { secondaryEmployeeId: null },
    { primaryEmployeeId: 99, secondaryEmployeeId: null },
  ])("separates only the own employee keys in %j", (employees) => {
    expect(splitEmployeeChangeFromStartDateChange({ ...period, ...employees })).toStrictEqual({
      startDateDto: period, employeeDto: employees,
    });
  });

  it("returns no employee request when neither employee key is present", () => {
    expect(splitEmployeeChangeFromStartDateChange(period)).toStrictEqual({
      startDateDto: period, employeeDto: null,
    });
  });

  it("preserves own keys with undefined values", () => {
    expect(splitEmployeeChangeFromStartDateChange({ ...period, primaryEmployeeId: undefined }).employeeDto)
      .toStrictEqual({ primaryEmployeeId: undefined });
  });

  it("does not treat inherited employee keys as changes", () => {
    const dto: UpdateClientDto = Object.assign(Object.create({ primaryEmployeeId: 99 }), period);
    expect(splitEmployeeChangeFromStartDateChange(dto)).toStrictEqual({ startDateDto: period, employeeDto: null });
  });

  it("does not mutate the input or reuse it as the start-date request", () => {
    const dto = Object.freeze({ ...period, primaryEmployeeId: 99, secondaryEmployeeId: null });
    const result = splitEmployeeChangeFromStartDateChange(dto);
    expect(dto).toStrictEqual({ ...period, primaryEmployeeId: 99, secondaryEmployeeId: null });
    expect(result.startDateDto).not.toBe(dto);
    expect(result.employeeDto).not.toBe(dto);
  });
});
