import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES } from "domain/constants/eformsign-auto-link-status";
import { MockClientRepository } from "../utils/mocks/client.repository.mock";
import { ClientFactory } from "../utils";

describe("link confirmation repository reads", () => {
    const findDocuments = jest.fn();
    const findClients = jest.fn();
    const prisma = {
        eformsign_doc: { findMany: findDocuments }, client: { findMany: findClients },
    } as unknown as PrismaService;
    beforeEach(() => {
        findDocuments.mockReset().mockResolvedValue([]);
        findClients.mockReset().mockResolvedValue([]);
    });
    it("filters unlinked, unpurged, eligible contract/null-kind rows by branch in SQL", async () => {
        const repository = new SbEformsignDocRepository(prisma);
        await repository.findLinkConfirmationCandidates("B");
        expect(findDocuments).toHaveBeenCalledWith({
            where: {
                clientId: null, permanentPurgeRequestedAt: null,
                statusType: { in: [...EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES] },
                AND: [
                    { OR: [{ branchId: "B" }, { branchId: null }] },
                    { OR: [{ documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT }, { documentKind: null }] },
                ],
            },
            orderBy: [{ createdDate: "desc" }, { id: "desc" }],
            select: {
                documentId: true, documentName: true, statusType: true, statusDetail: true,
                createdDate: true, branchId: true, clientId: true, permanentPurgeRequestedAt: true,
                documentKind: true, serviceRecordCaseId: true, templateId: true,
                customerName: true, customerPhone: true, stepRecipientSms: true, detailPayload: true,
            },
        });
    });
    it("narrows a client-filtered query by canonical phone or null-phone legacy SMS suffix", async () => {
        await new SbEformsignDocRepository(prisma).findLinkConfirmationCandidates("B", "01012345678");
        expect(findDocuments.mock.calls[0][0].where.AND[2]).toEqual({ OR: [
            { customerPhone: "01012345678" },
            { customerPhone: null, stepRecipientSms: { contains: "5678" } },
        ] });
    });
    it("batch-prefilters phones across all branches without findFirst or identity data beyond projection", async () => {
        const repository = new SbClientRepository(prisma);
        await repository.findPhoneMatches(["5678", "9999", "5678"]);
        expect(findClients).toHaveBeenCalledWith({
            where: { branchId: { not: null }, OR: [{ phone: { endsWith: "5678" } }, { phone: { endsWith: "9999" } }] },
            select: { id: true, branchId: true, name: true, phone: true, birthday: true },
        });
    });
    it("does not query clients for an empty suffix batch", async () => {
        expect(await new SbClientRepository(prisma).findPhoneMatches([])).toEqual([]);
        expect(findClients).not.toHaveBeenCalled();
    });
});

describe("MockClientRepository phone match parity", () => {
    it("returns every suffix match across branches but no null-branch/null-phone/unmatched clients", async () => {
        const repository = new MockClientRepository();
        const makeClient = (id: number, branchId: string | null, phone: string | null) => {
            const client = ClientFactory.create({ id, phone });
            client.branchId = branchId;
            client.phone = phone;
            return client;
        };
        repository.setData([
            makeClient(1, "B", "010-1234-5678"),
            makeClient(2, "OTHER", "+82 10-1234-5678"),
            makeClient(3, null, "01012345678"),
            makeClient(4, "B", null),
            makeClient(5, "B", "01099999999"),
        ]);
        const matches = await repository.findPhoneMatches(["5678"]);
        expect(matches.map(client => client.id)).toEqual([1, 2]);
        expect(Object.keys(matches[0] ?? {}).sort()).toEqual(["birthday", "branchId", "id", "name", "phone"]);
        expect(await repository.findPhoneMatches([])).toEqual([]);
    });
});
