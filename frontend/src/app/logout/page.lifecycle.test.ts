import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("desktop logout navigation lifecycle", () => {
  it("waits for server logout before redirecting and surfaces a failed revocation", () => {
    const resultIndex = source.indexOf("const result = await logout(pushEndpoint)");
    const redirectIndex = source.indexOf('router.replace("/login")');

    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(redirectIndex).toBeGreaterThan(resultIndex);
    expect(source).toContain("setError(result.error || \"로그아웃 중 오류가 발생했어요.\")");
    expect(source).not.toContain("getUserErrorMessage");
    expect(source).toContain("setTimeout(() => {");
  });
});
