import { EXPORT_ERRORS, ExportError, toExportErrorBody } from "domain/eformsign-backup/export";

// Contract 3.6 table, written out independently.
const CONTRACT: Record<string, [number, boolean]> = {
    UNAUTHORIZED: [401, false],
    NOT_FOUND: [404, false],
    INVALID_REQUEST: [400, false],
    INVALID_CURSOR: [400, false],
    CURSOR_PARAMETER_MISMATCH: [400, false],
    UNSUPPORTED_REVISION: [400, false],
    IDEMPOTENCY_CONFLICT: [409, false],
    SNAPSHOT_NOT_READY: [409, true],
    SNAPSHOT_FAILED: [409, false],
    SNAPSHOT_EXPIRED: [410, false],
    ARTIFACT_PENDING: [409, true],
    MIRROR_MISSING: [409, true],
    VERSION_CHANGED: [409, false],
    ARTIFACT_TOO_LARGE: [409, false],
    CONSISTENCY_CONFLICT: [409, false],
    SOURCE_REMOVED: [410, false],
    RATE_LIMITED: [429, true],
    EXPORT_UNAVAILABLE: [503, true],
    INTERNAL: [500, true],
};

describe("EXPORT_ERRORS (contract 3.6)", () => {
    it("has exactly the contract's codes", () => {
        expect(Object.keys(EXPORT_ERRORS).sort()).toEqual(Object.keys(CONTRACT).sort());
    });
    it.each(Object.entries(CONTRACT))("%s -> HTTP %s, retryable %s", (code, [status, retryable]) => {
        expect(EXPORT_ERRORS[code as keyof typeof EXPORT_ERRORS]).toEqual({ status, retryable });
    });
});

describe("ExportError", () => {
    it("carries code, reasonCode and retryAfterSeconds", () => {
        const error = new ExportError("ARTIFACT_PENDING", { reasonCode: "pending", retryAfterSeconds: 60 });
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe("ARTIFACT_PENDING");
        expect(error.reasonCode).toBe("pending");
        expect(error.retryAfterSeconds).toBe(60);
    });
    it("options are optional and default to undefined", () => {
        const error = new ExportError("NOT_FOUND");
        expect(error.reasonCode).toBeUndefined();
        expect(error.retryAfterSeconds).toBeUndefined();
    });
});

describe("toExportErrorBody", () => {
    it("emits only code, retryable, requestId when there are no extras", () => {
        const body = toExportErrorBody(new ExportError("UNAUTHORIZED"), "req-1");
        expect(body).toEqual({ code: "UNAUTHORIZED", retryable: false, requestId: "req-1" });
        expect(Object.keys(body).sort()).toEqual(["code", "requestId", "retryable"]);
    });
    it("includes reasonCode and retryAfterSeconds only when set", () => {
        expect(toExportErrorBody(new ExportError("RATE_LIMITED", { retryAfterSeconds: 5 }), "r"))
            .toEqual({ code: "RATE_LIMITED", retryable: true, requestId: "r", retryAfterSeconds: 5 });
        expect(toExportErrorBody(new ExportError("EXPORT_UNAVAILABLE", { reasonCode: "company-id-invalid" }), "r"))
            .toEqual({ code: "EXPORT_UNAVAILABLE", retryable: true, requestId: "r", reasonCode: "company-id-invalid" });
    });
    it("never exposes message or stack", () => {
        const body = toExportErrorBody(new ExportError("INTERNAL", { reasonCode: "x" }), "r") as unknown as Record<string, unknown>;
        expect(body).not.toHaveProperty("message");
        expect(body).not.toHaveProperty("stack");
        expect(body).not.toHaveProperty("name");
        expect(JSON.stringify(body)).not.toContain("ExportError");
    });
    it.each(Object.keys(CONTRACT))("body for %s matches the contract table", (code) => {
        const [, retryable] = CONTRACT[code]!;
        const body = toExportErrorBody(new ExportError(code as never), "id");
        expect(body.code).toBe(code);
        expect(body.retryable).toBe(retryable);
        expect(body.requestId).toBe("id");
    });
});
