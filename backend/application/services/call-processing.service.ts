import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class CallProcessingService {
    private readonly logger = new Logger(CallProcessingService.name);

    // Implemented in the extraction task; ingestion only needs the contract.
    async processCallRecord(callRecordId: string): Promise<void> {
        this.logger.warn(`processCallRecord(${callRecordId}) placeholder invoked`);
    }
}
