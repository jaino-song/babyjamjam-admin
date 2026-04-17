import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { DailyRecordService } from "application/services/daily-record.service";
import {
    FinalizeServiceRecordDto,
    FinalizeServiceRecordResponseDto,
    ListDailyRecordEntriesResponseDto,
    SubmitDailyRecordEntryDto,
    DailyRecordEntryResponseDto,
} from "interface/dto/daily-record.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { DailyRecordEntryEntity } from "domain/entities/daily-record-entry.entity";
import { FinalizeServiceRecordResult } from "application/usecases/eformsign-doc/finalize-service-record.usecase";

@Controller("daily-records")
@UseGuards(JwtGuard, TenantGuard)
export class DailyRecordController {
    constructor(private readonly dailyRecordService: DailyRecordService) {}

    @Post(":eformsignDocId/entries")
    async submitEntry(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("eformsignDocId") eformsignDocId: string,
        @Body() dto: SubmitDailyRecordEntryDto,
    ): Promise<DailyRecordEntryResponseDto> {
        const entry = await this.dailyRecordService.submitEntry(tenant.organizationId ?? "", {
            eformsignDocId: Number(eformsignDocId),
            recordDate: new Date(dto.recordDate),
            content: dto.content ?? null,
            submittedBy: dto.submittedBy ?? null,
        });
        return this.toResponseDto(entry);
    }

    @Get(":eformsignDocId/entries")
    async listEntries(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("eformsignDocId") eformsignDocId: string,
    ): Promise<ListDailyRecordEntriesResponseDto> {
        const result = await this.dailyRecordService.listEntries(
            tenant.organizationId ?? "",
            Number(eformsignDocId),
        );
        return {
            entries: result.entries.map(e => this.toResponseDto(e)),
            missingDates: result.missingDates,
            collectionStartDate: result.collectionStartDate,
            collectionEndDate: result.collectionEndDate,
            collectionPeriodDays: result.collectionPeriodDays,
        };
    }

    @Post(":eformsignDocId/finalize")
    async finalize(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("eformsignDocId") eformsignDocId: string,
        @Body() dto: FinalizeServiceRecordDto,
    ): Promise<FinalizeServiceRecordResponseDto> {
        const result: FinalizeServiceRecordResult = await this.dailyRecordService.finalize(
            tenant.organizationId ?? "",
            {
                eformsignDocId: Number(eformsignDocId),
                force: dto.force ?? false,
            },
        );
        return {
            documentId: result.doc.documentId,
            statusType: result.doc.statusType,
            finalizedAt: result.doc.finalizedAt ? result.doc.finalizedAt.toISOString() : null,
            forced: result.forced,
            missingDates: result.missingDates,
        };
    }

    private toResponseDto(entry: DailyRecordEntryEntity): DailyRecordEntryResponseDto {
        return {
            id: entry.id ?? "",
            eformsignDocId: entry.eformsignDocId,
            recordDate: entry.recordDate.toISOString().slice(0, 10),
            content: entry.content,
            submittedBy: entry.submittedBy,
            submittedAt: entry.submittedAt.toISOString(),
            createdAt: entry.createdAt.toISOString(),
        };
    }
}
