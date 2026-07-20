import { registerRequestSchema } from "./register";

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
