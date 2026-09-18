import fs from "node:fs";

const clientLayoutSource = fs.readFileSync(require.resolve("./layout"), "utf8");
const groupLayoutSource = fs.readFileSync(require.resolve("../../layout"), "utf8");

describe("service-record-admin auth redirect boundary", () => {
  it("derives the editor return path from the dynamic clientId layout params", () => {
    expect(clientLayoutSource).toContain("params: Promise<{ clientId: string }>");
    expect(clientLayoutSource).toContain("getSafeServiceRecordAdminReturnPath");
    expect(clientLayoutSource).toContain("`/service-record-admin/${clientId}`");
    expect(clientLayoutSource).toContain('redirect(appendSafeReturnPath("/login", returnPath))');
  });

  it("keeps the group shell free of a descendant-param auth assumption", () => {
    expect(groupLayoutSource).not.toContain("getCurrentUser");
    expect(groupLayoutSource).not.toContain("params:");
  });
});
