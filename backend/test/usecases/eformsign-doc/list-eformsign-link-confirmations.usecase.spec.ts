import { ConfigService } from "@nestjs/config";
import { validate } from "class-validator";

import { ListEformsignLinkConfirmationsUsecase } from "application/usecases/eformsign-doc/list-eformsign-link-confirmations.usecase";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import type { IClientRepository, ClientPhoneMatch } from "domain/repositories/client.repository.interface";
import type { IEformsignDocRepository, EformsignLinkConfirmationCandidate } from "domain/repositories/eformsign-doc.repository.interface";
import { UpdateClientDto } from "interface/dto/client.dto";

const detail = (name = "계약산모", birthday: string | null = "900101") => ({
    fields: [
        { id: "이용자 성명", value: name },
        { id: "이용자 연락처", value: "010-1234-5678" },
        ...(birthday === null ? [] : [{ id: "이용자 생년월일", value: birthday }]),
    ],
    recipients: [{ recipient_type: "02", name, sms: "010-1234-5678" }],
});

const doc = (overrides: Partial<EformsignLinkConfirmationCandidate> = {}): EformsignLinkConfirmationCandidate => ({
    documentId: "doc-1", documentName: "계약서", statusType: "020", statusDetail: "진행",
    createdDate: new Date("2026-09-01T00:00:00Z"), branchId: "B", clientId: null,
    permanentPurgeRequestedAt: null, documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
    serviceRecordCaseId: null, templateId: "contract", customerName: "fallback",
    customerPhone: "01012345678", stepRecipientSms: "01012345678", detailPayload: detail(),
    ...overrides,
});
const client = (overrides: Partial<ClientPhoneMatch> = {}): ClientPhoneMatch => ({
    id: 1, branchId: "B", name: "다른산모", phone: "+82 10-1234-5678", birthday: "1990-01-01", ...overrides,
});

describe("ListEformsignLinkConfirmationsUsecase", () => {
    let rows: EformsignLinkConfirmationCandidate[];
    let clients: ClientPhoneMatch[];
    const findLinkConfirmationCandidates = jest.fn();
    const findPhoneMatches = jest.fn();
    const findById = jest.fn();
    let usecase: ListEformsignLinkConfirmationsUsecase;

    beforeEach(() => {
        rows = [doc()]; clients = [client()];
        findLinkConfirmationCandidates.mockReset().mockImplementation(async () => rows);
        findPhoneMatches.mockReset().mockImplementation(async () => clients);
        findById.mockReset().mockImplementation(async (_branch: string, id: number) => clients.find(c => c.id === id) ?? null);
        usecase = new ListEformsignLinkConfirmationsUsecase(
            { findLinkConfirmationCandidates } as unknown as IEformsignDocRepository,
            { findPhoneMatches, findById } as unknown as IClientRepository,
            new ConfigService({ EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID: "service" }),
        );
    });

    it("lists a name mismatch with canonical response values", async () => {
        expect(await usecase.execute("B")).toEqual([{
            documentId: "doc-1", documentName: "계약서", statusType: "020", statusDetail: "진행",
            createdDate: "2026-09-01T00:00:00.000Z",
            document: { name: "계약산모", phone: "01012345678", birthday: "1990-01-01" },
            client: { id: 1, name: "다른산모", phone: "01012345678", birthday: "1990-01-01" },
            differences: ["name"],
        }]);
        expect(findPhoneMatches).toHaveBeenCalledWith(["5678"]);
        expect(findLinkConfirmationCandidates).toHaveBeenCalledWith("B", undefined);
    });

    it.each([
        ["계약산모", "1991-01-01", ["birthday"]],
        ["다른산모", "1991-01-01", ["name", "birthday"]],
        ["계약산모", null, ["birthday"]],
    ])("compares client %s / %s", async (name, birthday, differences) => {
        clients = [client({ name, birthday })];
        const result = await usecase.execute("B");
        expect(result[0]?.differences).toEqual(differences);
        expect(result[0]?.client.birthday).toBe(birthday);
    });

    it("lists missing document birthday as null", async () => {
        rows = [doc({ detailPayload: detail("계약산모", null) })];
        expect((await usecase.execute("B"))[0]?.document.birthday).toBeNull();
    });

    it.each(["900101", "1986.7.9", "1958-03-03", "2000년 2월 29일"])("emits a birthday UpdateClientDto accepts: %s", async birthday => {
        rows = [doc({ detailPayload: detail("계약산모", birthday) })];
        const result = await usecase.execute("B");
        const update = new UpdateClientDto();
        update.birthday = result[0]?.document.birthday;
        expect(update.birthday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(await validate(update)).toEqual([]);
    });

    it.each(["not-a-date", "2099-01-01"])("emits unparseable/future document birthday as null: %s", async birthday => {
        rows = [doc({ detailPayload: detail("계약산모", birthday) })];
        expect((await usecase.execute("B"))[0]?.document.birthday).toBeNull();
    });

    it("includes a null-kind mirrored contract", async () => {
        rows = [doc({ documentKind: null })];
        expect(await usecase.execute("B")).toHaveLength(1);
    });

    it("honours an explicit contract kind even with revision service-record metadata", async () => {
        rows = [doc({ serviceRecordCaseId: "revision-case" })];
        expect(await usecase.execute("B")).toHaveLength(1);
    });

    it.each([
        { documentKind: null, templateId: "service" },
        { documentKind: null, serviceRecordCaseId: "case" },
        { statusType: "049" }, { statusType: "047" }, { statusType: "099" }, { statusType: "001" },
        { clientId: 1 }, { permanentPurgeRequestedAt: new Date() },
        { documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT }, { branchId: "OTHER" },
        { detailPayload: null }, { detailPayload: "unreadable" },
        { customerPhone: "invalid" },
    ])("excludes ineligible document %j", async overrides => {
        rows = [doc(overrides)];
        expect(await usecase.execute("B")).toEqual([]);
    });

    it.each(["040", "045", "071", "070", "003"])("includes existing-client eligible status %s", async statusType => {
        rows = [doc({ statusType })];
        expect(await usecase.execute("B")).toHaveLength(1);
    });

    it("excludes fully matching identity", async () => {
        clients = [client({ name: "계약 산모" })];
        expect(await usecase.execute("B")).toEqual([]);
    });
    it("excludes two exact phone matches within branch", async () => {
        clients = [client(), client({ id: 2 })];
        expect(await usecase.execute("B")).toEqual([]);
    });
    it("excludes zero matches and suffix-only collisions", async () => {
        clients = [];
        expect(await usecase.execute("B")).toEqual([]);
        clients = [client({ phone: "01099995678" })];
        expect(await usecase.execute("B")).toEqual([]);
    });
    it("uses branch-only uniqueness for branch-owned documents", async () => {
        clients = [client(), client({ id: 2, branchId: "OTHER" })];
        expect(await usecase.execute("B")).toHaveLength(1);
    });
    it("never reveals a branchless document to either branch when phone is ambiguous company-wide", async () => {
        rows = [doc({ branchId: null })];
        clients = [client(), client({ id: 2, branchId: "OTHER" })];
        expect(await usecase.execute("B")).toEqual([]);
        expect(await usecase.execute("OTHER")).toEqual([]);
    });
    it("lists branchless document only for its unique client's branch", async () => {
        rows = [doc({ branchId: null })];
        expect(await usecase.execute("B")).toHaveLength(1);
        expect(await usecase.execute("OTHER")).toEqual([]);
    });
    it("falls back to candidate phone only when customerPhone is absent", async () => {
        rows = [doc({ customerPhone: null })];
        expect(await usecase.execute("B")).toHaveLength(1);
        rows = [doc({ customerPhone: "01099995678" })];
        expect(await usecase.execute("B")).toEqual([]);
    });
    it("uses customerName only for display when candidate cannot be extracted", async () => {
        rows = [doc({ detailPayload: {} })];
        const result = await usecase.execute("B");
        expect(result[0]?.document).toEqual({ name: "fallback", phone: "01012345678", birthday: null });
        expect(result[0]?.differences).toEqual(["name", "birthday"]);
    });
    it("narrows document query by the branch-owned filtered client's phone", async () => {
        expect(await usecase.execute("B", 1)).toHaveLength(1);
        expect(findById).toHaveBeenCalledWith("B", 1);
        expect(findLinkConfirmationCandidates).toHaveBeenCalledWith("B", "01012345678");
        clients.push(client({ id: 2, phone: "01099999999" }));
        expect(await usecase.execute("B", 2)).toEqual([]);
    });
    it("returns empty for another branch's client or a missing client without reading documents", async () => {
        clients = [client({ branchId: "OTHER" })];
        expect(await usecase.execute("B", 1)).toEqual([]);
        expect(await usecase.execute("B", 99)).toEqual([]);
        expect(findLinkConfirmationCandidates).not.toHaveBeenCalled();
    });
    it("orders newest first", async () => {
        rows.push(doc({ documentId: "new", createdDate: new Date("2026-10-01T00:00:00Z") }));
        expect((await usecase.execute("B")).map(row => row.documentId)).toEqual(["new", "doc-1"]);
    });
});
