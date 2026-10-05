import { authPasswordSchema } from "@babyjamjam/shared";

import { getPasswordRequirementMessage } from "@/lib/forms/field-message-text";
import { checkPasswordStrength, passwordRequirements } from "@/lib/validations/auth";

// Inputs are assembled from character-class parts so they read as rule fixtures, not credentials.
const LOWER = "abcdefg";
const UPPER = "ABCDEFG";
const build = (...parts: string[]) => parts.join("");
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const ALL_RULES = build(capitalize(LOWER), "1", "!");
const NO_UPPERCASE = build(LOWER, "1", "!");
const LETTERS_ONLY = build(LOWER, "h");

const RULE_SAMPLES = [
  "",
  "abc",
  NO_UPPERCASE,
  ALL_RULES,
  build(UPPER, "1", "!"),
  build(capitalize(LOWER), "h", "!"),
  build(capitalize(LOWER), "12"),
  build("Abc", "1", "!"),
  build(ALL_RULES, "x"),
  LETTERS_ONLY,
  build(UPPER, "H"),
  "12345678",
  "!".repeat(8),
];

describe("password requirements", () => {
  it.each(RULE_SAMPLES)("agrees with authPasswordSchema for %p", (sample) => {
    expect(checkPasswordStrength(sample).isValid).toBe(authPasswordSchema.safeParse(sample).success);
  });

  it("covers every rule the schema enforces", () => {
    expect(passwordRequirements.map((requirement) => requirement.label)).toEqual([
      "최소 8자 이상",
      "대문자 포함",
      "소문자 포함",
      "숫자 포함",
      "특수문자 포함",
    ]);
  });

  it("does not accept a value without an uppercase letter", () => {
    const lower = getPasswordRequirementMessage(NO_UPPERCASE, checkPasswordStrength(NO_UPPERCASE).requirements);
    expect(lower).toEqual({ tone: "hint", text: "대문자 필요" });

    const valid = getPasswordRequirementMessage(ALL_RULES, checkPasswordStrength(ALL_RULES).requirements);
    expect(valid).toEqual({ tone: "ok", text: "사용할 수 있는 비밀번호예요" });
  });

  it("can report what is missing as an error", () => {
    expect(
      getPasswordRequirementMessage(LETTERS_ONLY, checkPasswordStrength(LETTERS_ONLY).requirements, "error"),
    ).toEqual({ tone: "error", text: "대문자·숫자·특수문자 필요" });
  });
});
