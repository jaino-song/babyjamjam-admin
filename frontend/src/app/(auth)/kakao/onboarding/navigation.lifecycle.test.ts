import fs from "node:fs";

const kakaoPageSource = fs.readFileSync(require.resolve("./page"), "utf8");
const kakaoFormSource = fs.readFileSync(require.resolve("./OnboardingForm"), "utf8");
const accountPageSource = fs.readFileSync(require.resolve("../../onboarding/page"), "utf8");

describe("onboarding return navigation lifecycle", () => {
  it("validates and forwards the editor path through Kakao onboarding", () => {
    expect(kakaoPageSource).toContain("searchParams: Promise<Record");
    expect(kakaoPageSource).toContain("getSafeServiceRecordAdminReturnPath");
    expect(kakaoPageSource).toContain('appendSafeReturnPath("/login", returnPath)');
    expect(kakaoPageSource).toContain("returnPath={returnPath}");
    expect(kakaoFormSource).toContain("returnPath?: string | null");
    expect(kakaoFormSource).toContain(
      'appendSafeReturnPath("/login?authError=PENDING_APPROVAL", returnPath)',
    );
  });

  it("keeps the account onboarding fallback on the validated local editor path", () => {
    expect(accountPageSource).toContain("searchParams: Promise<Record");
    expect(accountPageSource).toContain("getSafeServiceRecordAdminReturnPath");
    expect(accountPageSource).toContain(
      'appendSafeReturnPath("/login?authError=ACCOUNT_PROFILE_INCOMPLETE", returnPath)',
    );
  });
});
