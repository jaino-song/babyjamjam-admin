import { ExecutionContext, Logger } from "@nestjs/common";

import { ExportError, generateExportToken, hashExportToken } from "domain/eformsign-backup/export";
import { EformsignBackupExportGuard } from "infrastructure/auth/eformsign-backup-export.guard";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";

type Req = Record<string, unknown>;

function contextWith(headers: Record<string, string>, extra: Req = {}): { context: ExecutionContext; request: Req } {
    const request: Req = { headers, ...extra };
    return { context: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext, request };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => null, (error: unknown) => error);
}

describe("EformsignBackupExportGuard", () => {
    let repository: jest.Mocked<Pick<SbEformsignBackupExportCredentialRepository, "findActiveByTokenHash" | "touchLastUsed">>;
    let guard: EformsignBackupExportGuard;
    const loggerSpies: jest.SpyInstance[] = [];

    beforeEach(() => {
        repository = { findActiveByTokenHash: jest.fn(), touchLastUsed: jest.fn().mockResolvedValue(undefined) };
        guard = new EformsignBackupExportGuard(repository as unknown as SbEformsignBackupExportCredentialRepository);
        for (const level of ["log", "debug", "warn", "error", "verbose", "fatal"] as const) {
            loggerSpies.push(jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined));
        }
    });
    afterEach(() => { loggerSpies.splice(0).forEach(spy => spy.mockRestore()); });

    it("rejects missing, malformed, unknown and revoked credentials with the identical ExportError(UNAUTHORIZED)", async () => {
        const token = generateExportToken();
        repository.findActiveByTokenHash.mockResolvedValue(null);
        const cases: Array<[string, Record<string, string>]> = [
            ["missing", {}],
            ["malformed scheme", { authorization: `Basic ${token}` }],
            ["malformed token", { authorization: "Bearer ebx_short" }],
            ["unknown or revoked", { authorization: `Bearer ${token}` }],
        ];

        const errors: ExportError[] = [];
        for (const [, headers] of cases) {
            const error = await rejection(guard.canActivate(contextWith(headers).context));
            expect(error).toBeInstanceOf(ExportError);
            errors.push(error as ExportError);
        }
        for (const error of errors) {
            expect(error.code).toBe("UNAUTHORIZED");
            expect(error.reasonCode).toBeUndefined();
            expect(error.message).toBe(errors[0]?.message);
        }
    });

    it("never consults the database for a missing or malformed header", async () => {
        await rejection(guard.canActivate(contextWith({}).context));
        await rejection(guard.canActivate(contextWith({ authorization: "Bearer nope" }).context));
        expect(repository.findActiveByTokenHash).not.toHaveBeenCalled();
    });

    it("ignores cookies and JWT-shaped bearers", async () => {
        const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";
        const cookieOnly = contextWith({ cookie: `accessToken=${jwt}` });
        const jwtBearer = contextWith({ authorization: `Bearer ${jwt}` }, { cookies: { accessToken: jwt }, user: { id: "u1" } });

        expect(await rejection(guard.canActivate(cookieOnly.context))).toMatchObject({ code: "UNAUTHORIZED" });
        expect(await rejection(guard.canActivate(jwtBearer.context))).toMatchObject({ code: "UNAUTHORIZED" });
        expect(repository.findActiveByTokenHash).not.toHaveBeenCalled();
    });

    it("sets a request id before authenticating, even when authentication fails", async () => {
        const { context, request } = contextWith({});

        await rejection(guard.canActivate(context));

        expect(request["eformsignBackupExportRequestId"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(request["eformsignBackupExportPrincipal"]).toBeUndefined();
    });

    it("attaches the principal and touches last-used on success", async () => {
        const token = generateExportToken();
        repository.findActiveByTokenHash.mockResolvedValue({ id: "cred-1", principalId: "backup-worker-1", companyIds: ["C1"] });
        const { context, request } = contextWith({ authorization: `Bearer ${token}` });

        await expect(guard.canActivate(context)).resolves.toBe(true);

        expect(repository.findActiveByTokenHash).toHaveBeenCalledWith(hashExportToken(token));
        expect(request["eformsignBackupExportPrincipal"]).toEqual({ credentialId: "cred-1", principalId: "backup-worker-1", companyIds: ["C1"] });
        expect(request["eformsignBackupExportRequestId"]).toEqual(expect.any(String));
        expect(repository.touchLastUsed).toHaveBeenCalledWith("cred-1");
    });

    it("a failing last-used touch does not fail the request", async () => {
        repository.findActiveByTokenHash.mockResolvedValue({ id: "cred-1", principalId: "p", companyIds: ["C1"] });
        repository.touchLastUsed.mockRejectedValue(new Error("db down"));
        const { context } = contextWith({ authorization: `Bearer ${generateExportToken()}` });

        await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it("honours revocation on the very next call (T-EXP-02, no cache)", async () => {
        const token = generateExportToken();
        repository.findActiveByTokenHash
            .mockResolvedValueOnce({ id: "cred-1", principalId: "p", companyIds: ["C1"] })
            .mockResolvedValueOnce(null);
        const headers = { authorization: `Bearer ${token}` };

        await expect(guard.canActivate(contextWith(headers).context)).resolves.toBe(true);
        expect(await rejection(guard.canActivate(contextWith(headers).context))).toMatchObject({ code: "UNAUTHORIZED" });
        expect(repository.findActiveByTokenHash).toHaveBeenCalledTimes(2);
    });

    it("never writes the token or its hash to any logger level (T-EXP-14)", async () => {
        const token = generateExportToken();
        const hash = hashExportToken(token);
        repository.findActiveByTokenHash.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "cred-1", principalId: "p", companyIds: ["C1"] });

        await rejection(guard.canActivate(contextWith({ authorization: `Bearer ${token}` }).context));
        await guard.canActivate(contextWith({ authorization: `Bearer ${token}` }).context);
        await rejection(guard.canActivate(contextWith({ authorization: "Bearer ebx_short" }).context));

        const logged = JSON.stringify(loggerSpies.map(spy => spy.mock.calls));
        expect(logged).not.toContain(token);
        expect(logged).not.toContain(hash);
        expect(logged).not.toContain("ebx_");
    });

    it("lets a repository outage propagate rather than answering 401", async () => {
        repository.findActiveByTokenHash.mockRejectedValue(new Error("db down"));
        const error = await rejection(guard.canActivate(contextWith({ authorization: `Bearer ${generateExportToken()}` }).context));
        expect(error).not.toBeInstanceOf(ExportError);
    });
});
