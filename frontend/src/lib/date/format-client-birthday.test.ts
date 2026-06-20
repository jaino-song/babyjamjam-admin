import { formatClientBirthdayForDisplay } from "./format-client-birthday";

describe("formatClientBirthdayForDisplay", () => {
  it("formats six-digit YYMMDD client birthdays", () => {
    expect(formatClientBirthdayForDisplay("960502")).toBe("1996년 05월 02일");
    expect(formatClientBirthdayForDisplay("050101")).toBe("2005년 01월 01일");
  });

  it("formats compact full-year birthdays", () => {
    expect(formatClientBirthdayForDisplay("19960502")).toBe("1996년 05월 02일");
  });

  it("falls back to YYMMDD when compact data has extra non-year digits", () => {
    expect(formatClientBirthdayForDisplay("96050201")).toBe("1996년 05월 02일");
  });

  it("uses resident-registration century digits when present", () => {
    expect(formatClientBirthdayForDisplay("050101-4******")).toBe("2005년 01월 01일");
    expect(formatClientBirthdayForDisplay("960502-2******")).toBe("1996년 05월 02일");
  });

  it("formats ISO-like dates", () => {
    expect(formatClientBirthdayForDisplay("1996-05-02")).toBe("1996년 05월 02일");
    expect(formatClientBirthdayForDisplay("1996-05-02T00:00:00.000Z")).toBe("1996년 05월 02일");
  });

  it("returns fallback text for empty or invalid values", () => {
    expect(formatClientBirthdayForDisplay(null)).toBe("-");
    expect(formatClientBirthdayForDisplay(undefined)).toBe("-");
    expect(formatClientBirthdayForDisplay("")).toBe("-");
    expect(formatClientBirthdayForDisplay("991332")).toBe("991332");
    expect(formatClientBirthdayForDisplay("not-a-date")).toBe("not-a-date");
  });
});
