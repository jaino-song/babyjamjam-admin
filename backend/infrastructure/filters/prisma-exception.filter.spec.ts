import { Prisma } from "@prisma/client";
import type { ArgumentsHost } from "@nestjs/common";

const mockScope = {
    setLevel: jest.fn(),
    setTag: jest.fn(),
    setContext: jest.fn(),
    setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn((error: unknown) => {
    void error;
    return "event-id";
});

jest.mock("@sentry/nestjs", () => ({
    withScope: (callback: (scope: typeof mockScope) => unknown) => callback(mockScope),
    captureException: (error: unknown) => mockCaptureException(error),
}));

import { PrismaExceptionFilter } from "./prisma-exception.filter";

interface MockResponse {
    locals: Record<string, unknown>;
    setHeader: jest.Mock;
    status: jest.Mock;
    json: jest.Mock;
}

function createHost(path = "/clients", language = "ko-KR"): { host: ArgumentsHost; response: MockResponse } {
    const response: MockResponse = {
        locals: {},
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
    };
    const request = { originalUrl: path, url: path, method: "POST", acceptsLanguages: () => language };
    const host = {
        switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => request,
        }),
    } as unknown as ArgumentsHost;

    return { host, response };
}

function knownError(code: string, message = "database failure"): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(message, {
        code,
        clientVersion: "6.19.1",
    });
}

describe("PrismaExceptionFilter database failover telemetry", () => {
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        process.env["DATABASE_CONNECTION_MODE"] = "shared";
        process.env["SENTRY_ENVIRONMENT"] = "production";
        jest.clearAllMocks();
        consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleError.mockRestore();
        delete process.env["DATABASE_CONNECTION_MODE"];
        delete process.env["SENTRY_ENVIRONMENT"];
    });

    it.each(["P1001", "P1017"])("captures %s as failover eligible on every API path", (code) => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost("/auth/login");
        const rawMessage = "postgresql://user:password@db.example.test:5432/app?secret=value";

        filter.catch(knownError(code, rawMessage), host);

        expect(response.status).toHaveBeenCalledWith(503);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 503, code: "DEPENDENCY_UNAVAILABLE", outcome: "UNKNOWN", requestId: expect.any(String),
        }));
        expect(mockScope.setTag).toHaveBeenCalledWith("environment", "production");
        expect(mockScope.setTag).toHaveBeenCalledWith("db.route", "shared");
        expect(mockScope.setTag).toHaveBeenCalledWith("db.failover_eligible", "true");
        expect(mockScope.setTag).toHaveBeenCalledWith("prisma.code", code);
        if (code === "P1001" || code === "P1017") {
            expect(mockScope.setTag).toHaveBeenCalledWith("error.code", "DEPENDENCY_UNAVAILABLE");
            expect(mockScope.setTag).toHaveBeenCalledWith("outcome", "UNKNOWN");
        }
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockCaptureException.mock.calls[0]?.[0]).toMatchObject({
            message: "Database connectivity failure",
        });
        expect(JSON.stringify(mockScope.setTag.mock.calls)).not.toContain(rawMessage);
        expect(JSON.stringify(response.json.mock.calls)).not.toContain(rawMessage);
    });

    it.each(["P2024", "P2002"])("captures %s as explicitly ineligible without raw details", (code) => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost("/clients");
        const rawMessage = "postgresql://user:password@db.example.test:5432/app?secret=value";

        filter.catch(knownError(code, rawMessage), host);

        expect(mockScope.setTag).toHaveBeenCalledWith("db.failover_eligible", "false");
        expect(mockScope.setTag).toHaveBeenCalledWith("prisma.code", code);
        expect(JSON.stringify(mockScope.setTag.mock.calls)).not.toContain(rawMessage);
        expect(JSON.stringify(response.json.mock.calls)).not.toContain(rawMessage);
        expect(response.json.mock.calls[0]?.[0].code).toBe(code === "P2024" ? "DEPENDENCY_UNAVAILABLE" : "REQUEST_CONFLICT");
    });

    it("captures Prisma errors without a code as ineligible instead of treating them as failover signals", () => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost();
        const exception = new Prisma.PrismaClientValidationError(
            "Invalid query with database password",
            { clientVersion: "6.19.1" },
        );

        filter.catch(exception, host);

        expect(mockScope.setTag).toHaveBeenCalledWith("db.failover_eligible", "false");
        expect(mockScope.setTag).toHaveBeenCalledWith("prisma.code", "unknown");
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 500, code: "INTERNAL_ERROR", outcome: "UNKNOWN",
        }));
    });

    it("reports one database exception even on a service-record route", () => {
        const filter = new PrismaExceptionFilter();
        const { host, response } = createHost("/service-record/context");

        filter.catch(knownError("P1017"), host);

        expect(response.status).toHaveBeenCalledWith(503);
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockScope.setTag).toHaveBeenCalledWith("feature", "database-failover");
        expect(mockScope.setTag).not.toHaveBeenCalledWith("feature", "service-records");
    });
    it.each([
        ["P2002", 409, "REQUEST_CONFLICT"],
        ["P2003", 400, "REQUEST_INVALID"],
        ["P2025", 404, "RESOURCE_NOT_FOUND"],
        ["P2011", 400, "REQUEST_INVALID"],
        ["P2006", 400, "REQUEST_INVALID"],
        ["P2000", 400, "VALIDATION_FAILED"],
    ])("converts %s into the %s problem contract at status %i without private metadata", (code, status, problemCode) => {
        const { host, response } = createHost();
        const exception = new Prisma.PrismaClientKnownRequestError("private value", { code: String(code), clientVersion: "6.19.1", meta: { target: ["private_constraint"] } });
        new PrismaExceptionFilter().catch(exception, host);
        expect(response.status).toHaveBeenCalledWith(status);
        expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            code: problemCode,
            statusCode: status,
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            requestId: expect.any(String),
            type: expect.stringContaining("docs/error-management.md"),
        }));
        expect(response.json.mock.calls[0]?.[0].message).toBeDefined();
        expect(response.json.mock.calls[0]?.[0].error).toBeDefined();
        expect(JSON.stringify(response.json.mock.calls)).not.toMatch(/private|P2002|P2003|P2025|P2011|P2006|P2000/);
    });

    it.each(["P1002", "P1008"])("converts init failure %s into DEPENDENCY_UNAVAILABLE", (code) => {
        const { host, response } = createHost();
        new PrismaExceptionFilter().catch(knownError(code), host);
        expect(response.status).toHaveBeenCalledWith(503);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            code: "DEPENDENCY_UNAVAILABLE", statusCode: 503, outcome: "UNKNOWN",
        }));
    });

    it("keeps the rejected-mutation outcome on a read rejected by a known 4xx code", () => {
        const { host, response } = createHost("/clients", "ko-KR");
        const request = host.switchToHttp().getRequest<{ method: string }>();
        request.method = "GET";
        new PrismaExceptionFilter().catch(knownError("P2002"), host);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            code: "REQUEST_CONFLICT", statusCode: 409, outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        }));
    });

    it("maps an unregistered known code onto the INTERNAL_ERROR contract at 500", () => {
        const { host, response } = createHost();
        new PrismaExceptionFilter().catch(knownError("P9999"), host);
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            code: "INTERNAL_ERROR", statusCode: 500, outcome: "UNKNOWN",
        }));
    });

    it("negotiates English for database failures", () => {
        const { host, response } = createHost("/clients", "en-US");
        new PrismaExceptionFilter().catch(knownError("P1001"), host);
        expect(response.setHeader).toHaveBeenCalledWith("Content-Language", "en-US");
        expect(response.json.mock.calls[0]?.[0].detail).not.toMatch(/[가-힣]/);
        expect(response.json.mock.calls[0]?.[0].recovery).toEqual({ action: "CHECK_STATUS", retry: { mode: "NEVER" } });
    });

});
