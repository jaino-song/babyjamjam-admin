import { isStartDateChangeMode, START_DATE_CHANGE_MODES } from "./start-date-change";

describe("START_DATE_CHANGE_MODES", () => {
  it("contains exactly the supported modes in order", () => {
    expect(START_DATE_CHANGE_MODES).toEqual(["CONFIRM_STARTED", "RESTART", "MOVE"]);
  });
});

describe("isStartDateChangeMode", () => {
  it.each(["CONFIRM_STARTED", "RESTART", "MOVE"])("accepts %s", (value) => {
    expect(isStartDateChangeMode(value)).toBe(true);
  });

  it.each([
    { value: "move" },
    { value: "RESTART " },
    { value: "" },
    { value: "OTHER" },
    { value: undefined },
    { value: null },
    { value: 0 },
    { value: {} },
    { value: ["MOVE"] },
  ])("rejects $value", ({ value }) => {
    expect(isStartDateChangeMode(value)).toBe(false);
  });
});
