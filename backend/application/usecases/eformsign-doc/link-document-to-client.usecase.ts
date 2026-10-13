import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";

@Injectable()
export class LinkDocumentToClientUsecase {
    private readonly logger = new Logger(LinkDocumentToClientUsecase.name);

    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly holidayCalendar: HolidayCalendarService,
    ) {}

    async execute(branchid: string, documentId: string): Promise<void> {
        const doc = await this.eformsignDocRepository.findByDocumentId(branchid, documentId);
        if (!doc) {
            throw new NotFoundException(`Document ${documentId} not found`);
        }

        // A voided (파기) contract is dead: it never becomes the client's current contract, so no
        // client pointer (`e_doc_id`) is written for it. The status update itself is unaffected.
        if (doc.isVoided) {
            this.logger.debug(`Skipping client contract link for voided document ${documentId}`);
            return;
        }

        if (doc.documentKind === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT) {
            this.logger.debug(`Skipping client contract link for service-record document ${documentId}`);
            return;
        }

        // Business rule 계약-05: a client is never inferred from the recipient
        // phone here. An unlinked document is linked (or left alone) by the
        // mirror sync, which compares phone, name and birthday; a linked one
        // is never reassigned.
        if (doc.clientId === null) {
            this.logger.debug(`Skipping client contract link for unlinked document ${documentId}`);
            return;
        }

        const client = await this.clientRepository.findById(branchid, doc.clientId);
        if (!client) {
            throw new NotFoundException(`Client for document ${documentId} not found`);
        }

        if (client.eDocId === documentId) {
            return;
        }

        const linked = await this.eformsignDocRepository.linkClientIfActive(
            branchid,
            documentId,
            client.id,
        );
        if (!linked) {
            this.logger.debug(
                `Skipping client contract link for inactive document ${documentId}`,
            );
            return;
        }

        // SAVED computation: update() re-derives the duration from the
        // client's dates, so use the branch calendar fresh.
        const calendar = await this.holidayCalendar.forBranch(branchid, { fresh: true });
        client.update({ eDocId: documentId }, calendar);
        this.logger.log(`Linked document ${documentId} to client ${client.id}`);
    }
}
