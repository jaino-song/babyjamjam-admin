import { hasContractPhoneProblem, isUnchangedRegisteredPhone } from "../contract-field-messages";

describe("hasContractPhoneProblem", () => {
  it("flags an empty or incomplete phone", () => {
    expect(hasContractPhoneProblem("")).toBe(true);
    expect(hasContractPhoneProblem("010-66")).toBe(true);
  });

  it("accepts a complete mobile number", () => {
    expect(hasContractPhoneProblem("010-6621-1878")).toBe(false);
  });

  it("still flags a newly typed legacy 10-digit mobile number", () => {
    expect(hasContractPhoneProblem("011-123-4567")).toBe(true);
    expect(hasContractPhoneProblem("011-123-4567", "01099998888")).toBe(true);
  });

  it("accepts a legacy 10-digit number while it equals the registered client's stored phone", () => {
    expect(hasContractPhoneProblem("011-123-4567", "0111234567")).toBe(false);
    expect(hasContractPhoneProblem("011-123-4567", "011-123-4567")).toBe(false);
  });

  it("does not let an empty phone match an empty stored phone", () => {
    expect(hasContractPhoneProblem("", "")).toBe(true);
    expect(isUnchangedRegisteredPhone("", null)).toBe(false);
  });
});
