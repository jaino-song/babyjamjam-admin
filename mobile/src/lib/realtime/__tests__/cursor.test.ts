import { isValidRealtimeCursor } from "../cursor";

describe("isValidRealtimeCursor", () => {
  it.each(["1730000000000-0", "epoch1:42", "a.b_c-D:9", "x".repeat(64)])("accepts %s", (cursor) => {
    expect(isValidRealtimeCursor(cursor)).toBe(true);
  });

  it.each([
    "",
    null,
    undefined,
    "x".repeat(65),
    "has space",
    "semi;colon",
    "slash/",
    "a&b=c",
    "한글",
    "new\nline",
  ])("rejects %p", (cursor) => {
    expect(isValidRealtimeCursor(cursor as string | null | undefined)).toBe(false);
  });
});
