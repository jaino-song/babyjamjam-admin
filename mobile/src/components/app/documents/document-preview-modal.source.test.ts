import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./document-preview-modal"), "utf8");

describe("document preview authenticated transport source", () => {
  it("uses a managed object URL for preview and print", () => {
    expect(source).toContain("useAuthenticatedFileUrl(sourceUrl");
    expect(source).toContain("iframe.src = preview.url");
    expect(source).toContain("src={`${preview.url}#toolbar=0`}");
    expect(source).toContain("src={preview.url}");
    expect(source).not.toContain("src={getDownloadUrl(doc.id)}");
  });

  it("downloads through authenticated binary acquisition", () => {
    expect(source).toContain("downloadAuthenticatedFile(sourceUrl, filename)");
    expect(source).not.toContain("link.href = getDownloadUrl");
  });
});
