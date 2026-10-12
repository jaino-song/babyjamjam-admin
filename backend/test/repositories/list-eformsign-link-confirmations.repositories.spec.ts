import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES } from "domain/constants/eformsign-auto-link-status";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { handleModelOperation } from "infrastructure/database/tenant-isolation.extension";
import { TenantIsolationViolationError } from "infrastructure/tenant/tenant-isolation.reporter";

import { MockClientRepository } from "../utils/mocks/client.repository.mock";
import { ClientFactory } from "../utils";

jest.mock("@sentry/nestjs", () => ({
    withScope: (fn: (scope: unknown) => void) =>
        fn({ setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn() }),
    captureMessage: jest.fn(),
}));

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
                branchId: "B", clientId: null, permanentPurgeRequestedAt: null,
                statusType: { in: [...EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES] },
                AND: [
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
        expect(findDocuments.mock.calls[0][0].where.AND[1]).toEqual({ OR: [
            { customerPhone: "01012345678" },
            { customerPhone: null, stepRecipientSms: { contains: "5678" } },
        ] });
    });
    it("batch-prefilters phones only within the branch without findFirst or extra identity data", async () => {
        const repository = new SbClientRepository(prisma);
        await repository.findPhoneMatches("B", ["5678", "9999", "5678"]);
        expect(findClients).toHaveBeenCalledWith({
            where: { branchId: "B", OR: [{ phone: { endsWith: "5678" } }, { phone: { endsWith: "9999" } }] },
            select: { id: true, branchId: true, name: true, phone: true, birthday: true },
        });
    });
    it("does not query clients for an empty suffix batch", async () => {
        expect(await new SbClientRepository(prisma).findPhoneMatches("B", [])).toEqual([]);
        expect(findClients).not.toHaveBeenCalled();
    });
});

describe("MockClientRepository phone match parity", () => {
    it("returns branch-owned suffix matches but no other-branch/null-branch/null-phone/unmatched clients", async () => {
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
        const matches = await repository.findPhoneMatches("B", ["5678"]);
        expect(matches.map(client => client.id)).toEqual([1]);
        expect((await repository.findPhoneMatches("OTHER", ["5678"])).map(client => client.id)).toEqual([2]);
        expect(Object.keys(matches[0] ?? {}).sort()).toEqual(["birthday", "branchId", "id", "name", "phone"]);
        expect(await repository.findPhoneMatches("B", [])).toEqual([]);
    });
});

describe("phone matches through the real tenant isolation extension", () => {
    let previousMode: string | undefined;
    beforeEach(() => {
        previousMode = process.env["TENANT_ISOLATION_MODE"];
        process.env["TENANT_ISOLATION_MODE"] = "enforce";
    });
    afterEach(() => {
        if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
        else process.env["TENANT_ISOLATION_MODE"] = previousMode;
    });

    const clients = [
        { id: 1, branchId: "B", name: "client B", phone: "01012345678", birthday: null },
        { id: 2, branchId: "OTHER", name: "other client", phone: "01099995678", birthday: null },
    ];

    it("returns only branch-owned suffix collisions without an enforce-mode violation", async () => {
        const prisma = {
            client: {
                findMany: (args: { where: { branchId: unknown; OR: Array<{ phone: { endsWith: string } }> } }) =>
                    handleModelOperation({
                        model: "client", operation: "findMany", args,
                        query: async () => clients.filter(client =>
                            (typeof args.where.branchId !== "string" || client.branchId === args.where.branchId)
                            && args.where.OR.some(filter => client.phone.endsWith(filter.phone.endsWith))),
                    }),
            },
        } as unknown as PrismaService;
        await tenantContextStore.run({ origin: "http", branchId: "B" }, async () => {
            await expect(new SbClientRepository(prisma).findPhoneMatches("B", ["5678"]))
                .resolves.toEqual([clients[0]]);
        });
    });

    it("CONTROL: enforce mode rejects a cross-branch result with the same suffix", async () => {
        await tenantContextStore.run({ origin: "http", branchId: "B" }, async () => {
            await expect(handleModelOperation({
                model: "client", operation: "findMany",
                args: { where: { branchId: { not: null } } },
                query: async () => clients,
            })).rejects.toThrow(TenantIsolationViolationError);
        });
    });
});
