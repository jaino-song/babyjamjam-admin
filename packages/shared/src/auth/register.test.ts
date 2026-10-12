import { REGISTERABLE_ROLE_OPTIONS, registerRequestSchema } from "./register";

describe("registerRequestSchema", () => {
  it("accepts profile details and a requested role without a user-selected branch", () => {
    const result = registerRequestSchema.safeParse({
      email: "new@example.com",
      password: "Password1!",
      name: "New User",
      phone: "010-1234-5678",
      birthDate: "1990-01-01",
      role: "manager",
    });

    expect(result.success).toBe(true);
  });
});

describe("REGISTERABLE_ROLE_OPTIONS", () => {
  // 권한-04 (BJJ-435): user is shown as 회원 and admin as 지점장.
  it("names the registerable roles 지점장 / 매니저 / 회원", () => {
    expect(REGISTERABLE_ROLE_OPTIONS).toEqual([
      { value: "admin", label: "지점장" },
      { value: "manager", label: "매니저" },
      { value: "user", label: "회원" },
    ]);
  });
});
