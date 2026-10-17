import { ConfigService } from "@nestjs/config";

import { EformsignDocReconcileSchedulerService } from "application/services/eformsign-doc-reconcile-scheduler.service";
import { EformsignBackfillAlreadyRunningError } from "infrastructure/locking/eformsign-backfill-lock.service";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

const REQUIRED_EFORMSIGN_CONFIG = new Set([
    "EFORMSIGN_USER_EMAIL",
    "EFORMSIGN_API_URL",
    "EFORMSIGN_DOC_API_URL",
    "EFORMSIGN_API_KEY",
    "EFORMSIGN_PRIVATE_KEY",
    "EFORMSIGN_COMPANY_ID",
    "EFORMSIGN_TEMPLATE_ID",
]);
const reconciliationPrincipal = {
    branchId: "__system__:reconciliation",
    source: "worker" as const,
};

function createConfigService(
    enabled: string | undefined,
    withCredentials = false,
    allowUnlocked = false,
): ConfigService {
    return {
        get: jest.fn((key: string) => {
            if (key === "EFORMSIGN_RECONCILE_ENABLED") {
                return enabled;
            }
            if (key === "EFORMSIGN_RECONCILE_ALLOW_UNLOCKED") {
                return allowUnlocked ? "true" : undefined;
            }
            return withCredentials && REQUIRED_EFORMSIGN_CONFIG.has(key)
                ? `configured-${key}`
                : undefined;
        }),
    } as unknown as ConfigService;
}

function createSummary(overrides: Record<string, number> = {}) {
    return {
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        failed: 0,
        pages: 0,
        byDocumentType: {},
        ...overrides,
    };
}

describe("EformsignDocReconcileSchedulerService", () => {
    let backfill: { execute: jest.Mock };
    let lockService: { isAvailable: jest.Mock; runExclusive: jest.Mock };

    beforeEach(() => {
        backfill = { execute: jest.fn().mockResolvedValue(createSummary()) };
        lockService = {
            isAvailable: jest.fn().mockReturnValue(true),
            runExclusive: jest.fn((work: (lease: { isHeld: () => boolean }) => Promise<unknown>) =>
                work({ isHeld: () => true })),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // No default argument: it.each passes undefined deliberately, and a default would
    // silently turn that case into the enabled one.
    function createService(
        enabled: string | undefined,
        withCredentials = false,
        allowUnlocked = false,
        schedulerLease: ReturnType<typeof createSchedulerLeaseMock> = createSchedulerLeaseMock(),
    ) {
        return new EformsignDocReconcileSchedulerService(
            createConfigService(enabled, withCredentials, allowUnlocked),
            backfill as never,
            lockService as never,
            schedulerLease,
        );
    }

    describe("when the feature switch is off", () => {
        // This is the phase where the mirror stops being write-only. Everything stays
        // dormant until an environment opts in, so the step is reversible by config.
        it.each([undefined, "false", "1", "TRUE"])(
            "does nothing with EFORMSIGN_RECONCILE_ENABLED=%s",
            async (value) => {
                const service = createService(value);

                await service.reconcileDocuments();

                expect(backfill.execute).not.toHaveBeenCalled();
                expect(lockService.runExclusive).not.toHaveBeenCalled();
            },
        );
    });

    describe("reconciliation sweep", () => {
        it("runs by default when all eformsign credentials are configured", async () => {
            const service = createService(undefined, true);

            await service.reconcileDocuments();

            expect(lockService.runExclusive).toHaveBeenCalledTimes(1);
            expect(backfill.execute).toHaveBeenCalledTimes(1);
        });

        it("runs under the distributed lock and hands the lease to the sweep", async () => {
            const service = createService("true");

            await service.reconcileDocuments();

            expect(lockService.runExclusive).toHaveBeenCalledTimes(1);
            expect(backfill.execute).toHaveBeenCalledWith(
                expect.objectContaining({ shouldContinue: expect.any(Function), receiptContext: expect.objectContaining({ trigger: "reconciliation", lockMode: "valkey" }) }),
                reconciliationPrincipal,
            );
        });

        it("skips quietly when another sweep already holds the lock", async () => {
            lockService.runExclusive.mockRejectedValue(
                new EformsignBackfillAlreadyRunningError(),
            );
            const service = createService("true");

            await expect(service.reconcileDocuments()).resolves.toBeUndefined();
        });

        it("skips without a lock unless an unlocked run is explicitly approved", async () => {
            lockService.isAvailable.mockReturnValue(false);
            const service = createService("true");
            const warn = jest.spyOn(
                (service as unknown as { logger: { warn: (message: string) => void } }).logger,
                "warn",
            ).mockImplementation(() => undefined);

            await service.reconcileDocuments();
            await service.reconcileDocuments();

            expect(lockService.runExclusive).not.toHaveBeenCalled();
            expect(backfill.execute).not.toHaveBeenCalled();
            expect(warn.mock.calls.filter(([message]) => message.includes("VALKEY_URL")))
                .toHaveLength(1);
        });

        it("sweeps without a lock only under explicit single-replica approval", async () => {
            lockService.isAvailable.mockReturnValue(false);
            const service = createService("true", false, true);
            const warn = jest.spyOn(
                (service as unknown as { logger: { warn: (message: string) => void } }).logger,
                "warn",
            ).mockImplementation(() => undefined);

            await service.reconcileDocuments();
            await service.reconcileDocuments();

            expect(lockService.runExclusive).not.toHaveBeenCalled();
            expect(backfill.execute).toHaveBeenCalledTimes(2);
            expect(backfill.execute).toHaveBeenCalledWith(
                expect.objectContaining({ shouldContinue: expect.any(Function), receiptContext: expect.objectContaining({ trigger: "reconciliation", lockMode: "approved-unlocked" }) }),
                reconciliationPrincipal,
            );
            expect(warn.mock.calls.filter(([message]) =>
                message.includes("EFORMSIGN_RECONCILE_ALLOW_UNLOCKED")))
                .toHaveLength(1);
        });

        it("stops the sweep once the advertised runtime is spent", async () => {
            // SchedulerExecutionGuard only ages a stale token out on the next tick, a day
            // later, so the 30-minute bound is only real if the sweep itself polls it.
            let shouldContinue: (() => boolean) | undefined;
            backfill.execute.mockImplementation((options: { shouldContinue?: () => boolean }) => {
                shouldContinue = options.shouldContinue;
                return Promise.resolve(createSummary());
            });
            const nowSpy = jest.spyOn(Date, "now");
            nowSpy.mockReturnValue(1_000_000);
            const service = createService("true");

            await service.reconcileDocuments();

            expect(shouldContinue?.()).toBe(true);
            nowSpy.mockReturnValue(1_000_000 + 31 * 60 * 1000);
            expect(shouldContinue?.()).toBe(false);
        });

        it("escalates to error only once the sweep has failed several nights running", async () => {
            // This job has no other operator signal — Sentry here is filtered to
            // service-records — so a single bad night stays a warning and a streak does not.
            lockService.runExclusive.mockRejectedValue(new Error("coverage incomplete"));
            const service = createService("true");
            const logger = (service as unknown as {
                logger: { warn: (message: string) => void; error: (message: string) => void };
            }).logger;
            const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
            const error = jest.spyOn(logger, "error").mockImplementation(() => undefined);

            await service.reconcileDocuments();
            await service.reconcileDocuments();
            expect(error).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(2);

            await service.reconcileDocuments();
            expect(error).toHaveBeenCalledTimes(1);
            expect(error.mock.calls[0]?.[0]).toContain("3 in a row");

            // A good night clears the streak, so the next failure is a warning again.
            lockService.runExclusive.mockImplementationOnce(
                (work: (lease: { isHeld: () => boolean }) => Promise<unknown>) =>
                    work({ isHeld: () => true }),
            );
            await service.reconcileDocuments();
            await service.reconcileDocuments();
            expect(error).toHaveBeenCalledTimes(1);
        });

        it("counts nightly database outages toward the same escalation", async () => {
            // The cooldown lapses hours before the next nightly tick, so it cannot be what
            // surfaces a multi-day outage. If these did not count, a database that never
            // let a sweep finish would stay warning-level forever.
            const connectivityError = Object.assign(new Error("Can't reach database server"), {
                code: "P1001",
            });
            lockService.runExclusive.mockRejectedValue(connectivityError);
            const service = createService("true");
            const logger = (service as unknown as {
                logger: { warn: (message: string) => void; error: (message: string) => void };
            }).logger;
            jest.spyOn(logger, "warn").mockImplementation(() => undefined);
            const error = jest.spyOn(logger, "error").mockImplementation(() => undefined);

            // Ticks are a day apart, so the connectivity cooldown has long lapsed by the
            // next one — without advancing the clock the guard would refuse to start.
            let now = 1_000_000;
            jest.spyOn(Date, "now").mockImplementation(() => now);
            for (let night = 0; night < 3; night += 1) {
                await service.reconcileDocuments();
                now += 24 * 60 * 60 * 1000;
            }

            expect(error).toHaveBeenCalledTimes(1);
            expect(error.mock.calls[0]?.[0]).toContain("3 in a row");
        });

        it("treats a fail-closed sweep as an incomplete run, not a crash", async () => {
            // The sweep fails closed on incomplete coverage. Nightly, that means "this run
            // did not finish reconciling" — tomorrow's run picks up from what landed.
            lockService.runExclusive.mockRejectedValueOnce(
                new Error("Eformsign document coverage incomplete type=01 missing=2"),
            );
            const service = createService("true");

            await expect(service.reconcileDocuments()).resolves.toBeUndefined();

            lockService.runExclusive.mockImplementationOnce(
                (work: (lease: { isHeld: () => boolean }) => Promise<unknown>) =>
                    work({ isHeld: () => true }),
            );
            await service.reconcileDocuments();
            expect(backfill.execute).toHaveBeenCalledTimes(1);
        });

        it("keeps the failure streak when a completed document lacks a current-version audit trail", async () => {
            backfill.execute.mockRejectedValue(
                new Error("Completed eformsign document doc-1 is missing current-version files: audit_trail"),
            );
            const service = createService("true");
            const logger = (service as unknown as {
                logger: { warn: (message: string) => void; error: (message: string) => void };
            }).logger;
            jest.spyOn(logger, "warn").mockImplementation(() => undefined);
            const error = jest.spyOn(logger, "error").mockImplementation(() => undefined);

            await service.reconcileDocuments();
            await service.reconcileDocuments();
            await service.reconcileDocuments();

            expect(backfill.execute).toHaveBeenCalledTimes(3);
            expect(error).toHaveBeenCalledTimes(1);
            expect(error.mock.calls[0]?.[0]).toContain("3 in a row");
            expect(error.mock.calls[0]?.[0]).toContain("audit_trail");
        });

        it("ties shouldContinue to the scheduler lease under the distributed lock", async () => {
            let shouldContinue: (() => boolean) | undefined;
            backfill.execute.mockImplementation((options: { shouldContinue?: () => boolean }) => {
                shouldContinue = options.shouldContinue;
                return Promise.resolve(createSummary());
            });
            const schedulerLease = createSchedulerLeaseMock(true);
            const service = createService("true", false, false, schedulerLease);

            await service.reconcileDocuments();

            expect(shouldContinue?.()).toBe(true);
            schedulerLease.holdsLease.mockReturnValue(false);
            expect(shouldContinue?.()).toBe(false);
        });

        it("ties shouldContinue to the scheduler lease when running unlocked", async () => {
            lockService.isAvailable.mockReturnValue(false);
            let shouldContinue: (() => boolean) | undefined;
            backfill.execute.mockImplementation((options: { shouldContinue?: () => boolean }) => {
                shouldContinue = options.shouldContinue;
                return Promise.resolve(createSummary());
            });
            const schedulerLease = createSchedulerLeaseMock(true);
            const service = createService("true", false, true, schedulerLease);

            await service.reconcileDocuments();

            expect(shouldContinue?.()).toBe(true);
            schedulerLease.holdsLease.mockReturnValue(false);
            expect(shouldContinue?.()).toBe(false);
        });
    });

    /**
     * The scheduler binds no collection writer. Apart from the added `receiptContext`
     * argument (intended, covered above), lock, lease, deadline and failure handling
     * must be exactly what base did.
     */
    describe("without a collection writer it behaves as base", () => {
        const START = 1_000_000;
        const RUNTIME_BOUND_MS = 31 * 60 * 1000;

        function captureOptions() {
            const captured: Array<Record<string, unknown>> = [];
            backfill.execute.mockImplementation((options: Record<string, unknown>) => {
                captured.push(options);
                return Promise.resolve(createSummary());
            });
            return captured;
        }

        it("passes the usecase nothing beyond shouldContinue and the intended receiptContext", async () => {
            const captured = captureOptions();
            await createService("true").reconcileDocuments();
            lockService.isAvailable.mockReturnValue(false);
            await createService("true", false, true).reconcileDocuments();

            expect(captured).toHaveLength(2);
            for (const options of captured) {
                const baseOptions = { ...options };
                delete baseOptions["receiptContext"];
                expect(baseOptions).toEqual({ shouldContinue: expect.any(Function) });
            }
            expect(backfill.execute.mock.calls.map(([, principal]) => principal))
                .toEqual([reconciliationPrincipal, reconciliationPrincipal]);
        });

        it("under the distributed lock shouldContinue needs the deadline, the lock lease and the scheduler lease", async () => {
            const captured = captureOptions();
            const held = { value: true };
            lockService.runExclusive.mockImplementation(
                (work: (lease: { isHeld: () => boolean }) => Promise<unknown>) =>
                    work({ isHeld: () => held.value }));
            const schedulerLease = createSchedulerLeaseMock(true);
            const now = jest.spyOn(Date, "now").mockReturnValue(START);
            await createService("true", false, false, schedulerLease).reconcileDocuments();
            const shouldContinue = captured[0]!["shouldContinue"] as () => boolean;

            expect(shouldContinue()).toBe(true);
            held.value = false;
            expect(shouldContinue()).toBe(false);
            held.value = true;
            expect(shouldContinue()).toBe(true);
            schedulerLease.holdsLease.mockReturnValue(false);
            expect(shouldContinue()).toBe(false);
            schedulerLease.holdsLease.mockReturnValue(true);
            expect(shouldContinue()).toBe(true);
            now.mockReturnValue(START + RUNTIME_BOUND_MS);
            expect(shouldContinue()).toBe(false);
        });

        it("without a lock shouldContinue needs only the deadline and the scheduler lease", async () => {
            lockService.isAvailable.mockReturnValue(false);
            const captured = captureOptions();
            const schedulerLease = createSchedulerLeaseMock(true);
            const now = jest.spyOn(Date, "now").mockReturnValue(START);
            await createService("true", false, true, schedulerLease).reconcileDocuments();
            const shouldContinue = captured[0]!["shouldContinue"] as () => boolean;

            expect(lockService.runExclusive).not.toHaveBeenCalled();
            expect(shouldContinue()).toBe(true);
            schedulerLease.holdsLease.mockReturnValue(false);
            expect(shouldContinue()).toBe(false);
            schedulerLease.holdsLease.mockReturnValue(true);
            now.mockReturnValue(START + RUNTIME_BOUND_MS);
            expect(shouldContinue()).toBe(false);
        });

        it("never starts a sweep without the scheduler lease and does not touch the lock then", async () => {
            const service = createService("true", false, false, createSchedulerLeaseMock(false));

            await service.reconcileDocuments();

            expect(lockService.isAvailable).not.toHaveBeenCalled();
            expect(lockService.runExclusive).not.toHaveBeenCalled();
            expect(backfill.execute).not.toHaveBeenCalled();
        });

        it("logs the completed sweep from the returned summary exactly as before", async () => {
            backfill.execute.mockResolvedValue(createSummary({ fetched: 7, created: 3, updated: 2, skipped: 1, duplicates: 1 }));
            const service = createService("true");
            const log = jest.spyOn(
                (service as unknown as { logger: { log: (message: string) => void } }).logger,
                "log",
            ).mockImplementation(() => undefined);

            await service.reconcileDocuments();

            expect(log).toHaveBeenCalledWith(
                "[Eformsign Reconcile] Sweep completed fetched=7 created=3 updated=2 skipped=1 duplicates=1",
            );
        });

        it("treats a lost-lease failure from the sweep as an ordinary incomplete run that feeds the streak", async () => {
            backfill.execute.mockRejectedValue(new Error("Eformsign document backfill lost its execution lease"));
            const service = createService("true");
            const logger = (service as unknown as {
                logger: { warn: (message: string) => void; error: (message: string) => void };
            }).logger;
            const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
            const error = jest.spyOn(logger, "error").mockImplementation(() => undefined);

            await expect(service.reconcileDocuments()).resolves.toBeUndefined();
            await service.reconcileDocuments();
            expect(warn).toHaveBeenCalledTimes(2);
            expect(warn.mock.calls[0]?.[0]).toContain("(1 in a row)");
            expect(warn.mock.calls[0]?.[0]).toContain("lost its execution lease");
            expect(error).not.toHaveBeenCalled();

            await service.reconcileDocuments();
            expect(error).toHaveBeenCalledTimes(1);
            expect(error.mock.calls[0]?.[0]).toContain("3 in a row");
        });
    });
});
