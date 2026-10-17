import { normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { compareEformsignClientIdentity } from "application/utils/eformsign-client-identity";
import { extractEformsignContractClientCandidate, toEformsignDocumentDetail } from "application/utils/eformsign-contract-client-candidate";
import { configuredServiceRecordTemplateIds, isServiceRecordEformsignDocument } from "application/utils/eformsign-document-kind";
import { normalizePhone } from "application/utils/normalize-phone";
import { isEformsignAutoLinkEligibleStatus } from "domain/constants/eformsign-auto-link-status";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { CLIENT_REPOSITORY, IClientRepository, type ClientPhoneMatch } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

const PHONE_LOOKUP_SUFFIX_LENGTH = 4;

export interface EformsignLinkConfirmation {
    documentId: string;
    documentName: string | null;
    statusType: string;
    statusDetail: string;
    createdDate: string;
    document: { name: string | null; phone: string; birthday: string | null };
    client: { id: number; name: string; phone: string | null; birthday: string | null };
    differences: Array<"name" | "birthday">;
}

@Injectable()
export class ListEformsignLinkConfirmationsUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY) private readonly documents: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY) private readonly clients: IClientRepository,
        private readonly configService: ConfigService,
    ) {}

    async execute(branchId: string, clientId?: number): Promise<EformsignLinkConfirmation[]> {
        if (!branchId) return [];
        let filterPhone: string | undefined;
        if (clientId !== undefined) {
            const client = await this.clients.findById(branchId, clientId);
            if (!client || client.branchId !== branchId) return [];
            filterPhone = normalizePhone(client.phone) ?? undefined;
            if (!filterPhone) return [];
        }

        const rows = await this.documents.findLinkConfirmationCandidates(branchId, filterPhone);
        const serviceRecordTemplateIds = configuredServiceRecordTemplateIds(this.configService);
        const candidates = rows.flatMap(row => {
            if (row.clientId !== null || row.permanentPurgeRequestedAt !== null
                || row.branchId !== branchId
                || (row.documentKind !== EFORMSIGN_DOCUMENT_KIND.CONTRACT && row.documentKind !== null)
                || !isEformsignAutoLinkEligibleStatus(row.statusType)
                || (row.documentKind === null && isServiceRecordEformsignDocument(row, serviceRecordTemplateIds))) return [];
            const detail = toEformsignDocumentDetail(row.detailPayload);
            if (!detail) return [];
            const candidate = extractEformsignContractClientCandidate(detail);
            const phone = normalizePhone(row.customerPhone ?? candidate?.phone);
            if (!phone || (filterPhone !== undefined && phone !== filterPhone)) return [];
            return [{ row, candidate, phone }];
        });
        if (candidates.length === 0) return [];

        const phoneSuffixes = [...new Set(candidates.map(({ phone }) => phone.slice(-PHONE_LOOKUP_SUFFIX_LENGTH)))];
        const phoneMatches = await this.clients.findPhoneMatches(branchId, phoneSuffixes);
        const matchesByPhone = new Map<string, ClientPhoneMatch[]>();
        for (const client of phoneMatches) {
            const phone = normalizePhone(client.phone);
            if (!phone || client.branchId !== branchId) continue;
            const matches = matchesByPhone.get(phone) ?? [];
            matches.push(client);
            matchesByPhone.set(phone, matches);
        }
        const now = new Date();
        const result: EformsignLinkConfirmation[] = [];
        for (const { row, candidate, phone } of candidates) {
            const matches = matchesByPhone.get(phone) ?? [];
            if (matches.length !== 1) continue;
            const client = matches[0];
            if (!client || client.branchId !== branchId || (clientId !== undefined && client.id !== clientId)) continue;
            const differences = compareEformsignClientIdentity(candidate, client, now);
            if (differences.length === 0) continue;
            result.push({
                documentId: row.documentId, documentName: row.documentName,
                statusType: row.statusType, statusDetail: row.statusDetail, createdDate: row.createdDate.toISOString(),
                document: {
                    name: candidate?.name || row.customerName,
                    phone, birthday: normalizeBirthdayIsoDate(candidate?.birthday, now),
                },
                client: {
                    id: client.id, name: client.name, phone: normalizePhone(client.phone),
                    birthday: normalizeBirthdayIsoDate(client.birthday, now),
                },
                differences,
            });
        }
        return result.sort((a, b) => b.createdDate.localeCompare(a.createdDate));
    }
}
