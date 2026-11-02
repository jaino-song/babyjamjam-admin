import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./ContractCreationForm"), "utf8");

describe("ContractCreationForm registration boundaries", () => {
  it("keeps non-phone conflicts locally authored and provider authentication server-side", () => {
    expect(source).toContain('error.response?.status !== 409');
    expect(source).toContain('throw new AuthoredSubmissionError("고객 자동 등록에 실패했어요.")');
    expect(source).not.toContain("getApiErrorMessage");
    expect(source).not.toContain("eformsignApi.authenticate");
  });

  it("requests approval before reusing a client with the same phone", () => {
    expect(source).toContain('requestConfirmation("이미 같은 전화번호의 고객이 있습니다. 기존 고객으로 계약을 진행할까요?")');
    expect(source).toContain("reuseExistingClient: true");
    expect(source).toContain('dataComponent="desktop_contracts_creation_confirmation"');
  });

  it("has no manual (iframe) creation path left", () => {
    expect(source).not.toContain("handleManualContractCreation");
    expect(source).not.toContain("canCreateManually");
    expect(source).not.toContain("eformsignApi.generateDocument");
    expect(source).not.toContain("openDocument");
    expect(source).not.toContain('id="eformsign_iframe"');
  });
});
