import { AxiosError } from "axios";

import {
    isConcurrentAuthRefreshError,
    isEformsignTokenEndpoint,
} from "../client";

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

describe("isConcurrentAuthRefreshError", () => {
    it("recognizes the retryable BFF refresh response", () => {
        const error = new AxiosError(
            "refresh already in progress",
            "ERR_BAD_RESPONSE",
            {} as never,
            undefined,
            {
                status: 409,
                statusText: "Conflict",
                headers: {},
                config: {} as never,
                data: { code: "AUTH_REFRESH_REPLAY_CONCURRENT" },
            } as never,
        );

        expect(isConcurrentAuthRefreshError(error)).toBe(true);
    });
});
