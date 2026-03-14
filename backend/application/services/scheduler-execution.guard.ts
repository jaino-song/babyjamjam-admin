import { Logger } from "@nestjs/common";

interface SchedulerExecutionGuardOptions {
    logger: Logger;
    runningWarning: string;
    staleRunError: string;
    cooldownWarning: string;
    maxRunMs: number;
    cooldownMs: number;
}

export class SchedulerExecutionGuard {
    private activeRunToken: symbol | null = null;
    private activeRunStartedAt: number | null = null;
    private cooldownUntil = 0;

    constructor(private readonly options: SchedulerExecutionGuardOptions) {}

    tryStart(now = Date.now()): symbol | null {
        if (this.cooldownUntil > now) {
            return null;
        }

        if (this.activeRunToken && this.activeRunStartedAt !== null) {
            const activeDurationMs = now - this.activeRunStartedAt;
            if (activeDurationMs <= this.options.maxRunMs) {
                this.options.logger.warn(this.options.runningWarning);
                return null;
            }

            this.options.logger.error(
                `${this.options.staleRunError}; clearing stale lock after ${Math.ceil(activeDurationMs / 1000)}s`,
            );
            this.activeRunToken = null;
            this.activeRunStartedAt = null;
        }

        const token = Symbol("scheduler-run");
        this.activeRunToken = token;
        this.activeRunStartedAt = now;
        return token;
    }

    finish(token: symbol): void {
        if (this.activeRunToken !== token) {
            return;
        }

        this.activeRunToken = null;
        this.activeRunStartedAt = null;
    }

    enterCooldown(reason: string, now = Date.now()): void {
        this.cooldownUntil = Math.max(this.cooldownUntil, now + this.options.cooldownMs);
        this.options.logger.warn(
            `${this.options.cooldownWarning}; skipping new runs for ${Math.ceil(this.options.cooldownMs / 1000)}s (${reason})`,
        );
    }
}
