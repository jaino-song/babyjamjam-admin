import { formatClientBirthdayAsYYMMDD, formatClientBirthdayForDisplay } from "./format-client-birthday";

describe("formatClientBirthdayForDisplay", () => {
  it("formats six-digit YYMMDD client birthdays", () => {
    expect(formatClientBirthdayForDisplay("960502")).toBe("1996.05.02");
    expect(formatClientBirthdayForDisplay("050101")).toBe("2005.01.01");
  });

  it("formats compact full-year birthdays", () => {
    expect(formatClientBirthdayForDisplay("19960502")).toBe("1996.05.02");
  });

  it("falls back to YYMMDD when compact data has extra non-year digits", () => {
    expect(formatClientBirthdayForDisplay("96050201")).toBe("1996.05.02");
  });

  it("uses resident-registration century digits when present", () => {
    expect(formatClientBirthdayForDisplay("050101-4******")).toBe("2005.01.01");
    expect(formatClientBirthdayForDisplay("960502-2******")).toBe("1996.05.02");
  });

  it("formats ISO-like dates", () => {
    expect(formatClientBirthdayForDisplay("1996-05-02")).toBe("1996.05.02");
    expect(formatClientBirthdayForDisplay("1996-05-02T00:00:00.000Z")).toBe("1996.05.02");
  });

  it("returns fallback text for empty or invalid values", () => {
    expect(formatClientBirthdayForDisplay(null)).toBe("-");
    expect(formatClientBirthdayForDisplay(undefined)).toBe("-");
    expect(formatClientBirthdayForDisplay("")).toBe("-");
    expect(formatClientBirthdayForDisplay("991332")).toBe("991332");
    expect(formatClientBirthdayForDisplay("not-a-date")).toBe("not-a-date");
  });
});

describe("formatClientBirthdayAsYYMMDD", () => {
  it.each([
    ["1986.7.9", "860709"],
    ["1986년 7월 9일", "860709"],
    ["1986. 7. 9.", "860709"],
    ["1986 07 09", "860709"],
    ["86.07.09", "860709"],
    ["86.7.9", "860709"],
    ["１９８６．７．９", "860709"],
    ["1986-07-09 00:00:00", "860709"],
    ["1986-07-09T23:00:00-09:00", "860709"],
    ["1986-07-09Tgarbage", null],
    ["860709abc", null],
    ["1986111", null],
    ["07/09/1986", null],
    ["860709-2******", null],
    ["2099-07-09", null],
    ["1986.07/09", null],
    ["1986.07.09", "860709"],
    ["1986-7-9", "860709"],
    ["1986/7/9", "860709"],
    ["19860709", "860709"],
    ["860709", "860709"],
    ["2000.2.29", "000229"],
    ["1986.02.30", null],
    ["198679", null],
    [null, null],
  ])("formats %s without losing month and day boundaries", (raw, expected) => {
    expect(formatClientBirthdayAsYYMMDD(raw)).toBe(expected);
  });
});
