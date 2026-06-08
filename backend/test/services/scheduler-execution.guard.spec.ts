import { Logger } from "@nestjs/common";
import { SchedulerExecutionGuard } from "application/services/scheduler-execution.guard";

describe("SchedulerExecutionGuard", () => {
    const MAX_RUN_MS = 15 * 60 * 1000;
    const COOLDOWN_MS = 5 * 60 * 1000;

    const RUNNING_WARNING = "[Guard] Previous cycle is still running; skipping tick";
    const STALE_RUN_ERROR = "[Guard] Previous cycle exceeded the max runtime";
    const COOLDOWN_WARNING = "[Guard] Database connectivity issue detected";

    const createLogger = () =>
        ({
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
        }) as unknown as jest.Mocked<Logger>;

    let logger: jest.Mocked<Logger>;
    let guard: SchedulerExecutionGuard;
    let nowSpy: jest.SpyInstance<number, []>;

    const createGuard = () =>
        new SchedulerExecutionGuard({
            logger,
            runningWarning: RUNNING_WARNING,
            staleRunError: STALE_RUN_ERROR,
            cooldownWarning: COOLDOWN_WARNING,
            maxRunMs: MAX_RUN_MS,
            cooldownMs: COOLDOWN_MS,
        });

    beforeEach(() => {
        logger = createLogger();
        guard = createGuard();
        // Pin wall-clock so the default `now = Date.now()` parameters are deterministic;
        // every assertion still drives time explicitly via the `now` argument.
        nowSpy = jest.spyOn(Date, "now").mockReturnValue(0);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        jest.clearAllMocks();
    });

    describe("tryStart — run vs skip decision", () => {
        it("acquires a fresh lock token when idle and outside cooldown", () => {
            const token = guard.tryStart(1_000);

            expect(typeof token).toBe("symbol");
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("suppresses an overlapping run while a prior run is still active", () => {
            const first = guard.tryStart(0);
            expect(first).not.toBeNull();

            // Second tick fires before the first run finished and well within maxRunMs.
            const second = guard.tryStart(1_000);

            expect(second).toBeNull();
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(logger.warn).toHaveBeenCalledWith(RUNNING_WARNING);
        });

        it("suppresses overlapping runs every tick until the active run finishes", () => {
            expect(guard.tryStart(0)).not.toBeNull();

            expect(guard.tryStart(1_000)).toBeNull();
            expect(guard.tryStart(2_000)).toBeNull();
            expect(guard.tryStart(3_000)).toBeNull();

            // Money-critical: never hand out a second token while one is live.
            expect(logger.warn).toHaveBeenCalledTimes(3);
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("treats an active run exactly at maxRunMs as still running (boundary, not stale)", () => {
            expect(guard.tryStart(0)).not.toBeNull();

            // activeDurationMs === maxRunMs hits the `<=` branch → still running, skip.
            const second = guard.tryStart(MAX_RUN_MS);

            expect(second).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(RUNNING_WARNING);
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("clears a stale lock and starts a fresh run once maxRunMs is exceeded", () => {
            const first = guard.tryStart(0);
            expect(first).not.toBeNull();

            // One millisecond past the ceiling → stale lock is reclaimed.
            const second = guard.tryStart(MAX_RUN_MS + 1);

            expect(second).not.toBeNull();
            expect(second).not.toBe(first);
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledWith(
                `${STALE_RUN_ERROR}; clearing stale lock after ${Math.ceil((MAX_RUN_MS + 1) / 1000)}s`,
            );
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("rounds the stale-lock age up to whole seconds in the error log", () => {
            expect(guard.tryStart(0)).not.toBeNull();

            // 1500ms over the ceiling → ceil((maxRunMs + 1500) / 1000) seconds.
            guard.tryStart(MAX_RUN_MS + 1_500);

            expect(logger.error).toHaveBeenCalledWith(
                `${STALE_RUN_ERROR}; clearing stale lock after ${Math.ceil((MAX_RUN_MS + 1_500) / 1000)}s`,
            );
        });

        it("skips silently while inside cooldown even when idle", () => {
            guard.enterCooldown("db down", 0);
            logger.warn.mockClear();

            const token = guard.tryStart(COOLDOWN_MS - 1);

            expect(token).toBeNull();
            // Cooldown skip must not log per-tick noise.
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("resumes acquiring a token once cooldown has elapsed (cooldownUntil is exclusive)", () => {
            guard.enterCooldown("db down", 0);
            logger.warn.mockClear();

            // At exactly cooldownUntil the `>` check is false → run is allowed.
            const token = guard.tryStart(COOLDOWN_MS);

            expect(token).not.toBeNull();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("short-circuits on cooldown before evaluating the active lock", () => {
            // Acquire a lock, then enter cooldown while it is held.
            const first = guard.tryStart(0);
            expect(first).not.toBeNull();
            guard.enterCooldown("db down", 0);
            logger.warn.mockClear();

            // Tick inside the cooldown window: the cooldown branch returns null first,
            // so neither the running-warning nor the stale-lock paths are reached.
            const token = guard.tryStart(COOLDOWN_MS - 1);

            expect(token).toBeNull();
            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });
    });

    describe("finish — lock release", () => {
        it("releases the lock so the next tick can start a new run", () => {
            const first = guard.tryStart(0);
            expect(first).not.toBeNull();

            guard.finish(first as symbol);

            const second = guard.tryStart(1_000);
            expect(second).not.toBeNull();
            expect(second).not.toBe(first);
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it("ignores a finish call carrying a stale token (does not release the live lock)", () => {
            const stale = guard.tryStart(0) as symbol;
            // Reclaim as stale → a brand new token is now active.
            const live = guard.tryStart(MAX_RUN_MS + 1) as symbol;
            expect(live).not.toBe(stale);

            // The old run finally settles and calls finish with its dead token.
            guard.finish(stale);

            // The live lock must survive: an overlapping tick is still suppressed.
            const overlapping = guard.tryStart(MAX_RUN_MS + 2);
            expect(overlapping).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(RUNNING_WARNING);
        });

        it("is a no-op when no run is active", () => {
            expect(() => guard.finish(Symbol("ghost"))).not.toThrow();

            // Guard remains acquirable.
            expect(guard.tryStart(0)).not.toBeNull();
        });

        it("releases the lock even when the run threw (simulated try/finally release)", () => {
            const token = guard.tryStart(0) as symbol;

            // Caller pattern: try { ...throws... } finally { guard.finish(token) }.
            try {
                throw new Error("scheduled work blew up");
            } catch {
                guard.finish(token);
            }

            // After an error-path release the next run must proceed normally.
            const next = guard.tryStart(1_000);
            expect(next).not.toBeNull();
            expect(next).not.toBe(token);
        });
    });

    describe("enterCooldown — failure handling", () => {
        it("blocks new runs for the cooldown window and logs the reason", () => {
            guard.enterCooldown("P2024 connection pool", 0);

            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(logger.warn).toHaveBeenCalledWith(
                `${COOLDOWN_WARNING}; skipping new runs for ${Math.ceil(COOLDOWN_MS / 1000)}s (P2024 connection pool)`,
            );

            expect(guard.tryStart(1_000)).toBeNull();
            expect(guard.tryStart(COOLDOWN_MS - 1)).toBeNull();
        });

        it("never shortens an in-flight cooldown (Math.max guard)", () => {
            // First cooldown ends at 10_000 + COOLDOWN_MS.
            guard.enterCooldown("first", 10_000);
            const longestUntil = 10_000 + COOLDOWN_MS;

            // A later call computed from an earlier `now` would shorten the window
            // if it overwrote blindly; Math.max must keep the longer deadline.
            guard.enterCooldown("second", 0);

            // Just before the original deadline: still cooling down.
            expect(guard.tryStart(longestUntil - 1)).toBeNull();
            // At the original deadline: cleared.
            expect(guard.tryStart(longestUntil)).not.toBeNull();
        });

        it("extends the cooldown deadline when a newer failure arrives later", () => {
            guard.enterCooldown("first", 0);
            // Failure recurs near the end of the first window → window slides forward.
            guard.enterCooldown("second", COOLDOWN_MS - 1);
            const extendedUntil = COOLDOWN_MS - 1 + COOLDOWN_MS;

            expect(guard.tryStart(extendedUntil - 1)).toBeNull();
            expect(guard.tryStart(extendedUntil)).not.toBeNull();
        });

        it("logs a warning on every failure (one per cooldown entry)", () => {
            guard.enterCooldown("first", 0);
            guard.enterCooldown("second", 1_000);

            expect(logger.warn).toHaveBeenCalledTimes(2);
            expect(logger.error).not.toHaveBeenCalled();
        });
    });

    describe("full lifecycle", () => {
        it("run → finish → cooldown on failure → resume after cooldown", () => {
            // 1. Acquire and complete a clean run.
            const t1 = guard.tryStart(0) as symbol;
            expect(t1).not.toBeNull();
            guard.finish(t1);

            // 2. Next run fails and enters cooldown.
            const t2 = guard.tryStart(1_000) as symbol;
            expect(t2).not.toBeNull();
            guard.finish(t2);
            guard.enterCooldown("db down", 1_000);

            // 3. Ticks during cooldown are suppressed.
            expect(guard.tryStart(2_000)).toBeNull();

            // 4. After the window clears, runs resume.
            const t3 = guard.tryStart(1_000 + COOLDOWN_MS);
            expect(t3).not.toBeNull();
        });
    });
});
