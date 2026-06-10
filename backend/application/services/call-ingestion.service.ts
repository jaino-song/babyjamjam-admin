import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CallProcessingService } from "application/services/call-processing.service";
import { CallTranscriptWebhookDto } from "interface/dto/call-inbox.dto";

export interface IngestResult {
    duplicate: boolean;
    callRecordId: string;
}

@Injectable()
export class CallIngestionService {
    private readonly logger = new Logger(CallIngestionService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly processingService: CallProcessingService,
    ) {}

    async ingest(branchId: string, payload: CallTranscriptWebhookDto): Promise<IngestResult> {
        const existing = await this.prismaService.call_record.findUnique({
            where: { driveFileId: payload.fileId },
        });
        if (existing) {
            this.logger.log(`Duplicate webhook for drive file ${payload.fileId}; no-op`);
            return { duplicate: true, callRecordId: existing.id };
        }

        const record = await this.prismaService.call_record.create({
            data: {
                branchId,
                driveFileId: payload.fileId,
                fileName: payload.fileName,
                recordedAt: payload.recordedAt ? new Date(payload.recordedAt) : null,
                transcript: payload.transcript as unknown as Prisma.InputJsonValue,
                summary: payload.summary as unknown as Prisma.InputJsonValue ?? undefined,
                processingStatus: "RECEIVED",
            },
        });

        // Fire-and-forget (repo convention): webhook responds immediately,
        // extraction failures land in FAILED status for the retry cron.
        this.processingService.processCallRecord(record.id).catch((error) => {
            this.logger.error(`Extraction kickoff failed for ${record.id}: ${error}`);
        });

        return { duplicate: false, callRecordId: record.id };
    }
}
