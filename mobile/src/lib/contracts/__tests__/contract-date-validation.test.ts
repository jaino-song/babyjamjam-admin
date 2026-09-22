import {
  getContractDateValidation,
  getContractDateValues,
} from "../contract-date-validation";

describe("getContractDateValidation", () => {
  const validDates = {
    startDateInput: "260921",
    endDateInput: "260922",
    paymentDateInput: "260918",
  };

  it("accepts valid dates and returns their ISO values", () => {
    expect(getContractDateValidation(validDates)).toBeNull();
    expect(getContractDateValues(validDates)).toEqual({
      startDate: "2026-09-21",
      endDate: "2026-09-22",
      paymentDate: "2026-09-18",
    });
  });

  it("rejects a reversed service period with the end-date field", () => {
    const result = getContractDateValidation({
      ...validDates,
      endDateInput: "260920",
    });

    expect(result).toEqual({
      field: "endDate",
      message: "종료일은 시작일과 같거나 이후로 입력해 주세요.",
    });
  });

  it("rejects an incomplete visible input", () => {
    const result = getContractDateValidation({
      ...validDates,
      endDateInput: "26092",
    });

    expect(result?.field).toBe("endDate");
    expect(result?.message).toContain("종료일");
  });

  it("rejects an impossible payment date", () => {
    const result = getContractDateValidation({
      ...validDates,
      paymentDateInput: "260231",
    });

    expect(result?.field).toBe("paymentDate");
    expect(result?.message).toContain("본인부담금 수령 날짜");
  });
});
