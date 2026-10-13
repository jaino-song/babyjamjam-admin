import { Inject, Injectable } from "@nestjs/common";
import {
    resolveEformsignDocDisplayStatus,
    type EformsignDocDisplayStatus,
} from "application/utils/eformsign-doc-display-status";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { PrismaService } from "infrastructure/database/prisma.service";

export type EformsignDocWithContractEndDate = Omit<ReturnType<EformsignDocEntity["toJSON"]>, "voidedAt"> & {
    voidedAt: string | null;
    voidedByName: string | null;
    /** YYYY-MM-DD from the mirrored detail payload; null when not recoverable. */
    contractEndDate: string | null;
    /** Authoritative display status, stamped at serve time. */
    displayStatus: EformsignDocDisplayStatus;
};

@Injectable()
export class FindEformsignDocsByClientIdUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        private readonly holidayCalendar: HolidayCalendarService,
        private readonly prisma: PrismaService,
    ) {}

    execute(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        return this.eformsignDocRepository.findByClientId(branchid, clientId);
    }

    /**
     * Same rows, carrying the contract end date parsed from the mirrored detail
     * payloads so the client panel can apply the shared 서명 완료/검토 필요 rule.
     */
    async executeWithContractEndDates(
        branchid: string,
        clientId: number,
    ): Promise<EformsignDocWithContractEndDate[]> {
        const docs = await this.execute(branchid, clientId);
        const endDates = docs.length > 0
            ? await this.eformsignDocRepository.findContractEndDatesByDocumentIds(
                docs.map((doc) => doc.documentId),
            )
            : new Map<string, string>();
        // Display only, for the request's own branch: the cached calendar, fetched once for all rows.
        const calendar = await this.holidayCalendar.forBranch(branchid);
        const actorIds = [...new Set(docs.flatMap((doc) => doc.voidedBy ? [doc.voidedBy] : []))];
        const actors = actorIds.length > 0
            ? await this.prisma.user.findMany({
                where: { id: { in: actorIds } },
                select: { id: true, name: true },
            })
            : [];
        const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
        return docs.map((doc) => {
            const contractEndDate = endDates.get(doc.documentId) ?? null;
            return {
                ...doc.toJSON(),
                voidedAt: doc.voidedAt?.toISOString() ?? null,
                voidedByName: doc.voidedBy ? actorNames.get(doc.voidedBy) ?? null : null,
                contractEndDate,
                displayStatus: resolveEformsignDocDisplayStatus({
                    id: doc.documentId,
                    isVoided: doc.isVoided,
                    current_status: {
                        status_type: doc.statusType,
                        step_type: doc.stepType,
                        step_name: doc.stepName,
                    },
                    ...(contractEndDate ? { contract_end_date: contractEndDate } : {}),
                }, new Date(), calendar),
            };
        });
    }
}

