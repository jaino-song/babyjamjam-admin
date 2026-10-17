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
