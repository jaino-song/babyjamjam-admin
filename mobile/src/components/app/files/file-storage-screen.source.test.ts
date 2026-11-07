import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./file-storage-screen"), "utf8");

describe("mobile file preview source", () => {
  it("renders protected previews through a managed authenticated object URL", () => {
    expect(source).toContain("<iframe");
    expect(source).toContain("useAuthenticatedFileUrl(sourceUrl, canPreview)");
    expect(source).toContain("src={preview.url}");
    expect(source).not.toContain("window.open(getDownloadUrl");
    expect(source).not.toContain("제1조 (문서 개요)");
    expect(source).not.toContain('doc.uploadedBy || "송진호"');
    expect(source).not.toContain("확인 완료");
  });

  it("downloads and shares protected files only after authenticated acquisition", () => {
    expect(source).toContain("downloadAuthenticatedFile(getDownloadUrl(doc.id), doc.name)");
    expect(source).toContain("fetchAuthenticatedFileBlob(getDownloadUrl(doc.id))");
    expect(source).not.toContain("navigator.clipboard.writeText");
  });

  it("uses the document's source category label when the local category list cannot resolve it", () => {
    expect(source).toContain("doc.categoryLabel && !map.has(doc.categoryId)");
    expect(source).toContain("map.set(doc.categoryId, doc.categoryLabel)");
  });
});
