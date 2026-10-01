import { authPasswordSchema } from "@babyjamjam/shared";

import { getPasswordRequirementMessage } from "@/lib/forms/field-message-text";
import { checkPasswordStrength, passwordRequirements } from "@/lib/validations/auth";

const PASSWORDS = [
  "",
  "abc",
  "abcdefg1!",
  "Abcdefg1!",
  "ABCDEFG1!",
  "Abcdefgh!",
  "Abcdefg12",
  "Abc1!",
  "Abcdefg1!x",
  "abcdefgh",
  "ABCDEFGH",
  "12345678",
  "!!!!!!!!",
];

describe("password requirements", () => {
  it.each(PASSWORDS)("agrees with authPasswordSchema for %p", (password) => {
    expect(checkPasswordStrength(password).isValid).toBe(authPasswordSchema.safeParse(password).success);
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

  it("does not accept a password without an uppercase letter", () => {
    const lower = getPasswordRequirementMessage("abcdefg1!", checkPasswordStrength("abcdefg1!").requirements);
    expect(lower).toEqual({ tone: "hint", text: "대문자 필요" });

    const valid = getPasswordRequirementMessage("Abcdefg1!", checkPasswordStrength("Abcdefg1!").requirements);
    expect(valid).toEqual({ tone: "ok", text: "사용할 수 있는 비밀번호예요" });
  });

  it("can report what is missing as an error", () => {
    expect(
      getPasswordRequirementMessage("abcdefgh", checkPasswordStrength("abcdefgh").requirements, "error"),
    ).toEqual({ tone: "error", text: "대문자·숫자·특수문자 필요" });
  });
});
