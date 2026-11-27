import { Controller, Get, Header, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { EformsignBackupService } from "application/services/eformsign-backup.service";
import { EformsignBackupTokenGuard } from "infrastructure/auth/eformsign-backup-token.guard";
import { EformsignBackupWakeTransport } from "infrastructure/realtime/eformsign-backup-wake-transport";

const HEARTBEAT_MS = 15_000;

@Controller("internal/eformsign-backup")
@UseGuards(EformsignBackupTokenGuard)
export class EformsignBackupWakeController {
    constructor(
        private readonly transport: EformsignBackupWakeTransport,
        private readonly service: EformsignBackupService,
    ) {}

    @Get("ready-events/cutoff")
    @Header("Cache-Control", "no-store")
    readyEventCutoff(): Promise<{ until: string }> {
        return this.service.readyEventCutoff();
    }

    @Get("ready-wake")
    subscribe(@Res() response: Response): void {
        const write = (frame: string) => {
            if (response.destroyed || response.writableEnded) return;
            if (!response.write(frame + "\n")) response.destroy();
        };
        const subscription = this.transport.listen((frame) => {
            if (frame === "close") response.end();
            else write(frame);
        });
        if (!subscription) {
            response.status(503).end();
            return;
        }
        response.status(200).set({
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
        }).flushHeaders();
        const heartbeat = setInterval(() => write("heartbeat"), HEARTBEAT_MS);
        heartbeat.unref();
        response.once("close", () => {
            clearInterval(heartbeat);
            subscription.unsubscribe();
        });
        if (subscription.ready) write("ready");
    }
}
