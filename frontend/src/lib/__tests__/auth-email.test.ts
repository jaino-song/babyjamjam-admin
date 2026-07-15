import { getEmailFormatError, registerSchema } from "@/lib/validations/auth";

describe("auth email handling", () => {
  it("returns no inline error for blank values", () => {
    expect(getEmailFormatError("")).toBeUndefined();
    expect(getEmailFormatError("   ")).toBeUndefined();
  });

  it("returns an error for invalid email formats", () => {
    expect(getEmailFormatError("jainostudio@gmail,com")).toBe("이메일 주소를 확인해 주세요.");
    expect(getEmailFormatError("hello@domain")).toBe("이메일 주소를 확인해 주세요.");
  });

  it("accepts valid email formats", () => {
    expect(getEmailFormatError("jainostudio@gmail.com")).toBeUndefined();
    expect(getEmailFormatError("  jainostudio@gmail.com  ")).toBeUndefined();
  });

  it("keeps register schema validation aligned with inline validation", () => {
    const result = registerSchema.safeParse({
      email: "jainostudio@gmail,com",
      password: "password1!",
      confirmPassword: "password1!",
      name: "홍길동",
      phone: "010-1234-5678",
      birthDate: "1990-01-01",
      branchId: "org-1",
      role: "user",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues.some((issue) => issue.path[0] === "email")).toBe(true);
  });
});
