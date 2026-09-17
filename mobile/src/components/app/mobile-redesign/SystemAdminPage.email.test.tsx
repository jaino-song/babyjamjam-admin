import type { SystemAdminBranchInput } from "@/lib/api/system-admin";

import { normalizeSystemAdminBranchInput } from "./SystemAdminPage";

const baseInput: SystemAdminBranchInput = {
  name: "강남점",
  slug: "gangnam",
  ownerId: null,
  region: "서울",
  district: "강남구",
  address: "테헤란로 1",
  phone: "02-0000-0000",
  isActive: true,
};

describe("normalizeSystemAdminBranchInput", () => {
  it("omits a blank email from a new branch payload", () => {
    const input = { ...baseInput, email: "" };

    expect(normalizeSystemAdminBranchInput(input)).not.toHaveProperty("email");
    expect(input.email).toBe("");
  });

  it("omits a whitespace-only email from an updated branch payload", () => {
    const input = { ...baseInput, email: "   " };

    expect(normalizeSystemAdminBranchInput(input)).not.toHaveProperty("email");
    expect(input.email).toBe("   ");
  });

  it("preserves a supplied email after trimming surrounding whitespace", () => {
    const input = { ...baseInput, email: "  branch@example.com  " };

    expect(normalizeSystemAdminBranchInput(input)).toEqual({
      ...baseInput,
      email: "branch@example.com",
    });
  });
});
