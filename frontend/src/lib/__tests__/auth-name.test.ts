import { registerSchema, sanitizeNameInput } from "@/lib/validations/auth";

describe("auth name handling", () => {
  it("removes numbers and symbols from name input", () => {
    expect(sanitizeNameInput("홍길동123! 김@철수")).toBe("홍길동 김철수");
    expect(sanitizeNameInput("Jane-Doe_99")).toBe("JaneDoe");
  });

  it("rejects names containing numbers or symbols at validation time", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "password1!",
      confirmPassword: "password1!",
      name: "홍길동123",
      phone: "010-1234-5678",
      birthDate: "1990-01-01",
      organizationId: "org-1",
      role: "user",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues.some((issue) => issue.path[0] === "name")).toBe(true);
  });

  it("trims valid names during validation", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "password1!",
      confirmPassword: "password1!",
      name: "  홍길동  ",
      phone: "010-1234-5678",
      birthDate: "1990-01-01",
      organizationId: "org-1",
      role: "user",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.name).toBe("홍길동");
  });
});
