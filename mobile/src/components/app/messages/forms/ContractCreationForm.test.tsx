import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./ContractCreationForm"), "utf8");

describe("messages ContractCreationForm phone conflict", () => {
  it("should confirm reuse and retry client creation with reuseExistingClient", () => {
    expect(source).toContain("error.response?.status !== 409");
    expect(source).toContain("await requestPhoneConflictApproval()");
    expect(source).toContain("reuseExistingClient: true");
    expect(source).toContain('dataComponent="mobile-contract-phone-conflict-approval"');
  });
});
