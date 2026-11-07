import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { EformsignBackupService } from "application/services/eformsign-backup.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { EformsignBackupRunsQueryDto } from "interface/dto/eformsign-backup.dto";

@Controller("eformsign-backups")
@UseGuards(JwtGuard, OwnerGuard)
export class EformsignBackupRunsController {
    constructor(private readonly service: EformsignBackupService) {}

    @Get("runs")
    listRuns(@Query() query: EformsignBackupRunsQueryDto) {
        return this.service.listRuns(query.limit);
    }
}
