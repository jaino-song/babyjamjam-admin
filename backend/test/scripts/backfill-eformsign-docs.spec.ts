/** The operator CLI is evaluated only with mocked bootstrap, configuration, provider and DB graph. */
jest.mock("module/eformsign-doc.module", () => ({ EformsignDocModule: class {} }));
jest.mock("infrastructure/tenant/tenant.module", () => ({ TenantModule: class {} }));
jest.mock("application/utils/eformsign-backfill-safety", () => ({
    resolveEformsignBackfillTarget: () => ({ environment: "test", databaseTarget: "mock" }),
    assertEformsignBackfillConfirmation: jest.fn(),
}));
jest.mock("@nestjs/config", () => ({
    ConfigModule: { forRoot: jest.fn(() => class {}) }, ConfigService: class {},
}));
jest.mock("@nestjs/core", () => ({ NestFactory: { createApplicationContext: jest.fn() } }));

import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { BackfillEformsignDocsUsecase } from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { EformsignBackfillLockService } from "infrastructure/locking/eformsign-backfill-lock.service";
import { EformsignMirrorReadinessService } from "application/services/eformsign-mirror-readiness.service";

describe("operator backfill receipt context", () => {
    it.each([true, false])("passes explicit source and lock mode (locked=%s)", async locked => {
        const execute = jest.fn().mockResolvedValue({ failed: 0 });
        let closed!: () => void;
        const done = new Promise<void>(resolve => { closed = resolve; });
        const app = { get: (token: unknown) => {
            if (token === ConfigService) return { get: (key: string) => ({ EFORMSIGN_COMPANY_ID: "company-1",
                EFORMSIGN_BACKFILL_ALLOW_UNLOCKED: "true" } as Record<string, string>)[key] };
            if (token === BackfillEformsignDocsUsecase) return { execute };
            if (token === EformsignBackfillLockService) return { isAvailable: () => locked,
                runExclusive: (operation: (lease: { isHeld: () => boolean }) => unknown) => operation({ isHeld: () => true }) };
            if (token === EformsignMirrorReadinessService) return { assertReady: jest.fn().mockResolvedValue({}) };
            throw new Error("Unexpected CLI dependency");
        }, close: async () => { closed(); } };
        jest.mocked(NestFactory.createApplicationContext).mockResolvedValue(app as never);
        const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
        // Re-evaluate only the script, preserving all dependency identities and mocks.
        const scriptPath = require.resolve("../../scripts/backfill-eformsign-docs");
        delete require.cache[scriptPath];
        jest.isolateModules(() => {
            jest.doMock("@nestjs/core", () => ({ NestFactory }));
            jest.doMock("@nestjs/config", () => ({ ConfigService, ConfigModule: { forRoot: () => class {} } }));
            jest.doMock("application/usecases/eformsign-doc/backfill-eformsign-docs.usecase", () => ({
                BackfillEformsignDocsUsecase, BackfillEformsignDocsError: class extends Error {},
            }));
            jest.doMock("infrastructure/locking/eformsign-backfill-lock.service", () => ({ EformsignBackfillLockService }));
            jest.doMock("application/services/eformsign-mirror-readiness.service", () => ({ EformsignMirrorReadinessService }));
            require("../../scripts/backfill-eformsign-docs");
        });
        await done;
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({ receiptContext: {
            configuredCompanyId: "company-1", trigger: "operator-backfill", lockMode: locked ? "valkey" : "approved-unlocked",
        } }), expect.any(Object));
        log.mockRestore(); warn.mockRestore(); stderr.mockRestore();
    });
});

/**
 * The CLI binds no collection writer, so apart from the added `receiptContext` argument
 * (an intended difference) both entry points must call the usecase exactly as base did:
 * same options, same principal, same lease wiring, same failure handling.
 */
describe("operator backfill without a collection writer behaves as base", () => {
    const BASE_PRINCIPAL = { branchId: "__system__:backfill", source: "worker" as const };

    afterEach(() => { process.exitCode = undefined; jest.restoreAllMocks(); });

    async function runScript(scenario: {
        locked: boolean;
        allowUnlocked?: boolean;
        execute: jest.Mock;
    }) {
        let closed!: () => void;
        const done = new Promise<void>(resolve => { closed = resolve; });
        const lease = { held: true, isHeld: () => lease.held };
        const assertReady = jest.fn().mockResolvedValue({});
        const runExclusive = jest.fn((operation: (l: { isHeld: () => boolean }) => unknown) => operation(lease));
        const close = jest.fn(async () => { closed(); });
        const app = { get: (token: unknown) => {
            if (token === ConfigService) {
                return { get: (key: string) => ({
                    EFORMSIGN_COMPANY_ID: "company-1",
                    EFORMSIGN_BACKFILL_ALLOW_UNLOCKED: scenario.allowUnlocked === false ? "false" : "true",
                } as Record<string, string>)[key] };
            }
            if (token === BackfillEformsignDocsUsecase) return { execute: scenario.execute };
            if (token === EformsignBackfillLockService) return { isAvailable: () => scenario.locked, runExclusive };
            if (token === EformsignMirrorReadinessService) return { assertReady };
            throw new Error("Unexpected CLI dependency");
        }, close };
        jest.mocked(NestFactory.createApplicationContext).mockResolvedValue(app as never);
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
        const scriptPath = require.resolve("../../scripts/backfill-eformsign-docs");
        delete require.cache[scriptPath];
        jest.isolateModules(() => {
            jest.doMock("@nestjs/core", () => ({ NestFactory }));
            jest.doMock("@nestjs/config", () => ({ ConfigService, ConfigModule: { forRoot: () => class {} } }));
            jest.doMock("application/usecases/eformsign-doc/backfill-eformsign-docs.usecase", () => ({
                BackfillEformsignDocsUsecase, BackfillEformsignDocsError: class extends Error {},
            }));
            jest.doMock("infrastructure/locking/eformsign-backfill-lock.service", () => ({ EformsignBackfillLockService }));
            jest.doMock("application/services/eformsign-mirror-readiness.service", () => ({ EformsignMirrorReadinessService }));
            require("../../scripts/backfill-eformsign-docs");
        });
        await done;
        // `void main().catch(...)` sets the exit code a few microtasks after app.close().
        await new Promise<void>(resolve => setImmediate(resolve));
        return { lease, assertReady, runExclusive, close, stderr };
    }

    it("locked entry point: base options plus the intended receiptContext, lease wired to shouldContinue", async () => {
        const execute = jest.fn().mockResolvedValue({ failed: 0 });
        const { lease, runExclusive, assertReady, close } = await runScript({ locked: true, execute });

        expect(runExclusive).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        const [options, principal] = execute.mock.calls[0] as [Record<string, unknown>, unknown];
        const baseOptions = { ...options };
        delete baseOptions["receiptContext"];
        expect(baseOptions).toEqual({
            onProgress: expect.any(Function),
            shouldContinue: expect.any(Function),
            suppressOutboundAutomation: true,
        });
        expect(principal).toEqual(BASE_PRINCIPAL);
        const shouldContinue = options["shouldContinue"] as () => boolean;
        expect(shouldContinue()).toBe(true);
        lease.held = false;
        expect(shouldContinue()).toBe(false);
        expect(assertReady).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBeUndefined();
    });

    it("unlocked entry point: base options plus the intended receiptContext, no lease callback", async () => {
        const execute = jest.fn().mockResolvedValue({ failed: 0 });
        const { runExclusive, assertReady, close } = await runScript({ locked: false, execute });

        expect(runExclusive).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledTimes(1);
        const [options, principal] = execute.mock.calls[0] as [Record<string, unknown>, unknown];
        const baseOptions = { ...options };
        delete baseOptions["receiptContext"];
        expect(baseOptions).toEqual({
            onProgress: expect.any(Function),
            suppressOutboundAutomation: true,
        });
        expect(principal).toEqual(BASE_PRINCIPAL);
        expect(assertReady).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBeUndefined();
    });

    it("unlocked entry point without the explicit approval still refuses before touching the usecase", async () => {
        const execute = jest.fn();
        const { assertReady, close, stderr } = await runScript({ locked: false, allowUnlocked: false, execute });

        expect(execute).not.toHaveBeenCalled();
        expect(assertReady).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(1);
        expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("VALKEY_URL is unset");
    });

    it.each([true, false])("a lease-lost failure from the usecase fails the run as in base (locked=%s)", async locked => {
        const execute = jest.fn().mockRejectedValue(new Error("Eformsign document backfill lost its execution lease"));
        const { assertReady, close, stderr } = await runScript({ locked, execute });

        expect(execute).toHaveBeenCalledTimes(1);
        expect(assertReady).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(1);
        expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join(""))
            .toContain("Eformsign backfill failed: Eformsign document backfill lost its execution lease");
    });
});
