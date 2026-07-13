import { isEformsignTokenEndpoint } from "../client";

describe("isEformsignTokenEndpoint", () => {
    it.each([
        "/eformsign/documents",
        "/eformsign/documents/doc-1",
        "/eformsign/documents/doc-1/re-request",
        "/eformsign-docs",
        "/eformsign-docs/client-names",
        "/eformsign-docs/dispatch-headless",
        "/eformsign-docs/finalize-headless",
        "/generate-document",
        "/generate-staff-document",
        "/generate-signature",
        "/access-token",
        "/refresh-access-token",
    ])("classifies %s as eformsign token-backed", (url) => {
        expect(isEformsignTokenEndpoint(url)).toBe(true);
    });

    it.each([
        "/auth/login",
        "/auth/refresh",
        "/employees",
        "/file-storage/files",
        "/document-categories",
        undefined,
    ])("does not classify %s as eformsign token-backed", (url) => {
        expect(isEformsignTokenEndpoint(url)).toBe(false);
    });
});
