import fs from "node:fs";

const source = fs.readFileSync(
  require.resolve("../../../../components/app/files/file-upload-screen"),
  "utf8",
);

describe("mobile file upload navigation lifecycle", () => {
  it("locks header back and cancel while uploading", () => {
    expect(source).toContain("const handleExit = () =>");
    expect(source).toContain("if (isUploading) return");
    // The visibility picker was removed; header back and footer cancel remain locked.
    expect(source.match(/disabled=\{isUploading\}/g)).toHaveLength(2);
    // File selection also stays disabled until upload settings are ready.
    expect(source).toContain("const selectionDisabled = isUploading || !capabilitiesReady");
    expect(source).toMatch(/<input\s[^>]*type="file"[^>]*disabled=\{selectionDisabled\}/);
  });
});
