import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AlimtalkTriggerService } from "./alimtalk-trigger.service";

@Injectable()
export class AlimtalkTriggerSchedulerService {
    private readonly logger = new Logger(AlimtalkTriggerSchedulerService.name);
    private isRunning = false;

    constructor(private readonly triggerService: AlimtalkTriggerService) {}

    @Cron("*/1 * * * *", { timeZone: "Asia/Seoul" })
    async dispatchDueJobs(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn("[Scheduler] Previous due-job dispatch is still running; skipping tick");
            return;
        }

        this.isRunning = true;
        try {
            await this.triggerService.dispatchDueJobs();
        } catch (error) {
            this.logger.error(
                "[Scheduler] Failed to dispatch due trigger jobs",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.isRunning = false;
        }
    }
}
