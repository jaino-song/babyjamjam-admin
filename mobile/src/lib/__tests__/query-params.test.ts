import { parsePositiveIntQueryParam } from "../query-params";

describe("parsePositiveIntQueryParam", () => {
  it.each([
    ["1", 1],
    ["42", 42],
  ])("returns a number for positive integer query params", (raw, expected) => {
    expect(parsePositiveIntQueryParam(raw)).toBe(expected);
  });

  it.each([
    null,
    "",
    "0",
    "-1",
    "1.2",
    "001",
    "abc",
    "1e2",
    String(Number.MAX_SAFE_INTEGER + 1),
  ])("returns null for invalid query param %s", (raw) => {
    expect(parsePositiveIntQueryParam(raw)).toBeNull();
  });
});
