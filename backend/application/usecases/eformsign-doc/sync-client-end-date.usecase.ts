import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

const EFORMSIGN_END_DATE_FIELD_IDS = {
    year: "계약 종료 년도",
    month: "계약 종료 월",
    day: "계약 종료 일",
} as const;

@Injectable()
export class SyncClientEndDateUsecase {
    private readonly logger = new Logger(SyncClientEndDateUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchId: string, documentId: string, accessToken: string): Promise<void> {
        try {
            const document = await this.eformsignClient.getDocument(accessToken, documentId);
            const fields = document.fields ?? [];

            const findValue = (fieldId: string) => fields.find((field) => field.id === fieldId)?.value;
            const yearStr = findValue(EFORMSIGN_END_DATE_FIELD_IDS.year);
            const monthStr = findValue(EFORMSIGN_END_DATE_FIELD_IDS.month);
            const dayStr = findValue(EFORMSIGN_END_DATE_FIELD_IDS.day);

            if (!yearStr || !monthStr || !dayStr) {
                this.logger.warn(
                    `End date fields missing or empty on document ${documentId}; skipping client.endDate sync.`
                );
                return;
            }

            const year = Number(yearStr);
            const month = Number(monthStr);
            const day = Number(dayStr);

            if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
                this.logger.warn(
                    `Could not parse end date numeric values on document ${documentId}; skipping client.endDate sync.`
                );
                return;
            }

            const endDate = new Date(Date.UTC(year, month - 1, day));
            const isSameDate =
                endDate.getUTCFullYear() === year &&
                endDate.getUTCMonth() === month - 1 &&
                endDate.getUTCDate() === day;

            if (!isSameDate) {
                this.logger.warn(`Invalid end date values on document ${documentId}; skipping client.endDate sync.`);
                return;
            }

            const doc = await this.eformsignDocRepository.findByDocumentId(branchId, documentId);
            if (!doc) {
                this.logger.warn(`eformsign_doc not found for ${documentId}; cannot sync client.endDate.`);
                return;
            }

            const client = await this.clientRepository.findById(branchId, doc.clientId);
            if (!client) {
                this.logger.warn(`Client ${doc.clientId} not found for document ${documentId}; cannot sync endDate.`);
                return;
            }

            client.update({ endDate });
            await this.clientRepository.update(branchId, client);

            this.logger.log(`Synced client ${doc.clientId} endDate from document ${documentId}.`);
        } catch (error) {
            this.logger.error(`Failed to sync client endDate for document ${documentId}: ${error}`);
        }
    }
}
