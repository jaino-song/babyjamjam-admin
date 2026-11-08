import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";

import { EformsignBackupService } from "application/services/eformsign-backup.service";
import { EformsignBackupTokenGuard } from "infrastructure/auth/eformsign-backup-token.guard";
import {
    EformsignBackupCreateRunDto, EformsignBackupDocumentsQueryDto, EformsignBackupFileParamsDto,
} from "interface/dto/eformsign-backup.dto";

@Controller("internal/eformsign-backup")
@UseGuards(EformsignBackupTokenGuard)
export class EformsignBackupInternalController {
    constructor(private readonly service: EformsignBackupService) {}

    @Get("documents")
    listDocuments(@Query() query: EformsignBackupDocumentsQueryDto) {
        return this.service.listDocuments(query.cursor, query.limit);
    }

    @Get("files/:fileId")
    async getFile(@Param() params: EformsignBackupFileParamsDto, @Res() res: Response) {
        const { buffer, sha256 } = await this.service.getFile(params.fileId);
        res.status(200).set({
            "Content-Type": "application/pdf", "Content-Length": buffer.length,
            "X-Content-Sha256": sha256, "Cache-Control": "no-store",
        }).send(buffer);
    }

    @Post("runs")
    createRun(@Body() dto: EformsignBackupCreateRunDto) {
        return this.service.createRun(dto);
    }
}
