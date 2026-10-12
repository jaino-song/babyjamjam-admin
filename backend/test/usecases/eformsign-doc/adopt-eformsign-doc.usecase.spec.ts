import { Logger } from "@nestjs/common";

import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { CreateEformsignDocUsecase } from "application/usecases/eformsign-doc/create-eformsign-doc.usecase";
import { EformsignDocOwnershipConflictError } from "domain/repositories/eformsign-doc.repository.interface";
import { createHolidayCalendarStub } from "../../utils/holiday-calendar.stub";

const TEST_PRINCIPAL = {
    userId: "test-user",
    branchId: "branch-1",
    globalRole: "owner",
    branchRole: "owner",
} as const;

function createCredentialBoundary(accessToken = "token") {
    return {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken, refreshToken: "refresh-token" })),
    };
}

describe("AdoptEformsignDocUsecase", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an explicit foreign client before creating or mirroring", async () => {
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-foreign" }) };
        const mirror = { syncDocumentWithToken: jest.fn() };
        const clients = { findById: jest.fn().mockResolvedValue(null), findByPhone: jest.fn() };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-foreign",
                current_status: { status_type: "060", expired_date: 0, step_recipients: [] },
            }) } as never,
            create as never,
            clients as never,
            mirror as never,
            { findByDocumentId: jest.fn().mockResolvedValue(null) } as never,
        );

        await expect(usecase.execute("branch-1", { documentId: "doc-foreign", clientId: 999 }, TEST_PRINCIPAL))
            .rejects.toMatchObject({
                status: 404,
                response: expect.objectContaining({ code: "RESOURCE_NOT_FOUND", outcome: "NOT_APPLIED" }),
            });
        expect(clients.findById).toHaveBeenCalledWith("branch-1", 999);
        expect(create.execute).not.toHaveBeenCalled();
        expect(mirror.syncDocumentWithToken).not.toHaveBeenCalled();
    });

    describe("without an explicit client (inferred from the recipient phone)", () => {
        const CLIENT_PHONE = "01012345678";

        const remoteFor = (
            overrides: { name?: string | null; birthday?: string | null; customerSms?: string } = {},
        ) => ({
            id: "doc-phone",
            document_name: "계약서",
            current_status: {
                status_type: "060", expired_date: 0,
                step_recipients: [{ id: CLIENT_PHONE, name: "고객", recipient_type: "02" }],
            },
            recipients: [{ recipient_type: "02", name: "김고객", sms: overrides.customerSms ?? "010-1234-5678" }],
            fields: [
                ...(overrides.name === null ? [] : [{ id: "이용자 성명", value: overrides.name ?? "김고객", type: "text" }]),
                ...(overrides.birthday === null
                    ? []
                    : [{ id: "이용자 생년월일", value: overrides.birthday ?? "1992-03-04", type: "date" }]),
            ],
        });

        const setup = (options: {
            remote?: unknown;
            client?: { id: number; name: string; birthday: string | null; phoneNormalized?: string | null } | null;
            localRow?: { clientId: number | null } | null;
        } = {}) => {
            const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-phone" }) };
            const mirror = { syncDocumentWithToken: jest.fn().mockResolvedValue(undefined) };
            const clients = {
                findById: jest.fn(),
                findByPhone: jest.fn().mockResolvedValue(
                    options.client === undefined
                        ? { id: 7, name: "김고객", birthday: "1992-03-04", phoneNormalized: CLIENT_PHONE }
                        : options.client,
                ),
            };
            const docs = {
                findByDocumentId: jest.fn().mockResolvedValue(options.localRow ?? null),
            };
            const usecase = new AdoptEformsignDocUsecase(
                createCredentialBoundary() as never,
                { execute: jest.fn().mockResolvedValue(options.remote ?? remoteFor()) } as never,
                create as never,
                clients as never,
                mirror as never,
                docs as never,
            );
            return { usecase, create, mirror, clients, docs };
        };

        it.each([
            ["no local row", null],
            ["an unlinked local row", { clientId: null }],
            ["a local row already linked to this client", { clientId: 7 }],
        ])("adopts a phone, name and birthday match with %s", async (_label, localRow) => {
            const { usecase, create, clients, docs } = setup({ localRow });

            await usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL);

            expect(clients.findByPhone).toHaveBeenCalledWith("branch-1", CLIENT_PHONE);
            expect(clients.findById).not.toHaveBeenCalled();
            expect(docs.findByDocumentId).toHaveBeenCalledWith("branch-1", "doc-phone");
            expect(create.execute).toHaveBeenCalledWith("branch-1", expect.objectContaining({
                clientId: 7, expectedOwnerClientId: 7, preserveExistingMirrorProjection: true,
            }));
        });

        it("accepts a document customer phone written without hyphens when it equals the client's", async () => {
            const { usecase, create } = setup({ remote: remoteFor({ customerSms: CLIENT_PHONE }) });

            await usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL);

            expect(create.execute).toHaveBeenCalledWith("branch-1", expect.objectContaining({ clientId: 7 }));
        });

        it("reports a raced inferred ownership conflict as the usual missing-client error", async () => {
            const { usecase, create, mirror } = setup({ localRow: { clientId: null } });
            create.execute.mockRejectedValueOnce(new EformsignDocOwnershipConflictError("doc-phone"));

            await expect(usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL))
                .rejects.toEqual(new Error("clientId가 필요합니다."));
            expect(mirror.syncDocumentWithToken).not.toHaveBeenCalled();
        });

        it("leaves the client pointer untouched when the real create path encounters a raced claim", async () => {
            const client = {
                id: 7, name: "김고객", birthday: "1992-03-04", phoneNormalized: CLIENT_PHONE,
                eDocId: null, update: jest.fn(),
            };
            const clients = {
                findByPhone: jest.fn().mockResolvedValue(client),
                findById: jest.fn().mockResolvedValue(client),
                update: jest.fn(), updateIfTargetVersion: jest.fn(),
            };
            const docs = {
                findByDocumentId: jest.fn().mockResolvedValue({ clientId: null }),
                upsertByDocumentId: jest.fn().mockRejectedValue(new EformsignDocOwnershipConflictError("doc-phone")),
            };
            const mirror = { syncDocumentWithToken: jest.fn() };
            const create = new CreateEformsignDocUsecase(docs as never, clients as never, createHolidayCalendarStub());
            const usecase = new AdoptEformsignDocUsecase(
                createCredentialBoundary() as never,
                { execute: jest.fn().mockResolvedValue(remoteFor()) } as never,
                create, clients as never, mirror as never, docs as never,
            );

            await expect(usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL))
                .rejects.toEqual(new Error("clientId가 필요합니다."));
            expect(docs.upsertByDocumentId).toHaveBeenCalledWith("branch-1", expect.anything(), {
                preserveExistingMirrorProjection: true, expectedOwnerClientId: 7,
            });
            expect(client.eDocId).toBeNull();
            expect(client.update).not.toHaveBeenCalled();
            expect(clients.update).not.toHaveBeenCalled();
            expect(clients.updateIfTargetVersion).not.toHaveBeenCalled();
            expect(mirror.syncDocumentWithToken).not.toHaveBeenCalled();
        });

        it("does not translate unrelated create failures", async () => {
            const { usecase, create } = setup();
            const error = new Error("storage failed");
            create.execute.mockRejectedValueOnce(error);
            await expect(usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL))
                .rejects.toBe(error);
        });

        it("accepts the same name and birthday in a different written form", async () => {
            const { usecase, create } = setup({
                remote: remoteFor({ birthday: "1992. 3. 4." }),
                client: { id: 7, name: " 김 고객 ", birthday: "920304", phoneNormalized: CLIENT_PHONE },
            });

            await usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL);

            expect(create.execute).toHaveBeenCalledWith("branch-1", expect.objectContaining({ clientId: 7 }));
        });

        it("refuses a full match when the local document is already linked to another client", async () => {
            const { usecase, create, mirror } = setup({ localRow: { clientId: 99 } });

            await expect(usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL))
                .rejects.toThrow("clientId가 필요합니다.");
            expect(create.execute).not.toHaveBeenCalled();
            expect(mirror.syncDocumentWithToken).not.toHaveBeenCalled();
        });

        const matched = { id: 7, name: "김고객", birthday: "1992-03-04", phoneNormalized: CLIENT_PHONE };

        it.each([
            ["a different name", { name: "박고객" }, matched],
            ["a different birthday", { birthday: "1992-03-05" }, matched],
            ["a client without a stored birthday", {}, { ...matched, birthday: null }],
            ["a document without a customer name", { name: null }, matched],
            ["a document without a birthday", { birthday: null }, matched],
            ["a document customer phone different from the client's", { customerSms: "010-9999-8888" }, matched],
            ["a client without a normalized phone", {}, { ...matched, phoneNormalized: null }],
        ])("refuses a phone match with %s", async (_label, remoteOverrides, client) => {
            const { usecase, create, mirror, docs } = setup({
                remote: remoteFor(remoteOverrides),
                client,
            });

            await expect(usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL))
                .rejects.toThrow("clientId가 필요합니다.");
            expect(create.execute).not.toHaveBeenCalled();
            expect(mirror.syncDocumentWithToken).not.toHaveBeenCalled();
            expect(docs.findByDocumentId).not.toHaveBeenCalled();
        });

        it("refuses when no client has the recipient phone", async () => {
            const { usecase, create, docs } = setup({ client: null });

            await expect(usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL))
                .rejects.toThrow("clientId가 필요합니다.");
            expect(create.execute).not.toHaveBeenCalled();
            expect(docs.findByDocumentId).not.toHaveBeenCalled();
        });

        it("refuses when the document has no recipient phone to look up", async () => {
            const remote = remoteFor();
            remote.current_status.step_recipients = [];
            const { usecase, create, clients } = setup({ remote });

            await expect(usecase.execute("branch-1", { documentId: "doc-phone" }, TEST_PRINCIPAL))
                .rejects.toThrow("clientId가 필요합니다.");
            expect(clients.findByPhone).not.toHaveBeenCalled();
            expect(create.execute).not.toHaveBeenCalled();
        });
    });

    it("keeps an explicitly chosen client without comparing identity or the local row", async () => {
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-chosen" }) };
        const clients = {
            findById: jest.fn().mockResolvedValue({ id: 7, name: "전혀 다른 이름", birthday: null }),
            findByPhone: jest.fn(),
        };
        const docs = { findByDocumentId: jest.fn().mockResolvedValue({ clientId: 99 }) };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-chosen",
                current_status: {
                    status_type: "060", expired_date: 0,
                    step_recipients: [{ id: "01012345678", name: "고객", recipient_type: "01" }],
                },
            }) } as never,
            create as never,
            clients as never,
            { syncDocumentWithToken: jest.fn() } as never,
            docs as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-chosen", clientId: 7 }, TEST_PRINCIPAL);

        expect(clients.findByPhone).not.toHaveBeenCalled();
        expect(docs.findByDocumentId).not.toHaveBeenCalled();
        expect(create.execute).toHaveBeenCalledWith("branch-1", expect.objectContaining({ clientId: 7 }));
        expect(create.execute.mock.calls[0][1]).not.toHaveProperty("expectedOwnerClientId");
        const conflict = new EformsignDocOwnershipConflictError("doc-chosen");
        create.execute.mockRejectedValueOnce(conflict);
        await expect(usecase.execute("branch-1", { documentId: "doc-chosen", clientId: 7 }, TEST_PRINCIPAL))
            .rejects.toBe(conflict);
    });

    it("uses document-id upsert semantics on repeated adoption", async () => {
        const now = Date.parse("2026-07-03T00:00:00.000Z");
        jest.spyOn(Date, "now").mockReturnValue(now);
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-1" }) };
        const mirror = { syncDocumentWithToken: jest.fn().mockResolvedValue(undefined) };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-1",
                updated_date: 1_751_500_800_000,
                document_name: "계약서 - 고객",
                template: { id: "template-1", name: "표준 계약서" },
                creator: { name: "생성자" },
                last_editor: { name: "최종 편집자" },
                fields: [{ id: "이용자 성명", value: "김고객" }],
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "01",
                    step_index: "1",
                    step_name: "서명 요청",
                    step_recipients: [
                        { recipient_type: "01", id: "01012345678", name: "고객" },
                        { recipient_type: "06", id: "reviewer", name: "검토자" },
                    ],
                    expired_date: 3,
                },
            }) } as never,
            create as never,
            { findById: jest.fn().mockResolvedValue({ id: 7 }), findByPhone: jest.fn() } as never,
            mirror as never,
            { findByDocumentId: jest.fn().mockResolvedValue(null) } as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-1", clientId: 7 }, TEST_PRINCIPAL);
        await usecase.execute("branch-1", { documentId: "doc-1", clientId: 7 }, TEST_PRINCIPAL);

        expect(create.execute).toHaveBeenCalledTimes(2);
        expect(create.execute).toHaveBeenNthCalledWith(2, "branch-1", expect.objectContaining({
            documentId: "doc-1",
            clientId: 7,
            preserveExistingMirrorProjection: true,
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "최종 편집자",
            stepRecipientTypes: ["01", "06"],
            expiredDate: new Date(now + 3 * 24 * 60 * 60 * 1000),
        }));
        expect(mirror.syncDocumentWithToken).toHaveBeenNthCalledWith(
            2,
            "token",
            "doc-1",
            { expectedUpdatedDate: 1_751_500_800_000 },
        );
        expect(create.execute.mock.invocationCallOrder[0]!).toBeLessThan(
            mirror.syncDocumentWithToken.mock.invocationCallOrder[0]!,
        );
    });

    it.each([
        ["doc_complete", "003"],
        ["50", "050"],
    ])("normalizes persisted vendor status %s to %s", async (rawStatus, expectedStatus) => {
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-status" }) };
        const mirror = { syncDocumentWithToken: jest.fn().mockResolvedValue(undefined) };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-status",
                document_name: "계약서",
                template: { id: "template-1", name: "표준 계약서" },
                current_status: {
                    status_type: rawStatus,
                    status_doc_detail: "완료",
                    step_type: "05",
                    step_index: "1",
                    step_name: "완료",
                    step_recipients: [],
                    expired_date: 0,
                },
            }) } as never,
            create as never,
            { findById: jest.fn().mockResolvedValue({ id: 7 }), findByPhone: jest.fn() } as never,
            mirror as never,
            { findByDocumentId: jest.fn().mockResolvedValue(null) } as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-status", clientId: 7 }, TEST_PRINCIPAL);

        expect(create.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({ statusType: expectedStatus }),
        );
    });

    it("preserves no-expiry semantics when adopting a document with zero remaining days", async () => {
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-no-expiry" }) };
        const mirror = { syncDocumentWithToken: jest.fn().mockResolvedValue(undefined) };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-no-expiry",
                document_name: "무기한 계약서",
                template: { id: "template-1", name: "표준 계약서" },
                creator: { name: "생성자" },
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "01",
                    step_index: "1",
                    step_name: "서명 요청",
                    step_recipients: [],
                    expired_date: 0,
                },
            }) } as never,
            create as never,
            { findById: jest.fn().mockResolvedValue({ id: 7 }), findByPhone: jest.fn() } as never,
            mirror as never,
            { findByDocumentId: jest.fn().mockResolvedValue(null) } as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-no-expiry", clientId: 7 }, TEST_PRINCIPAL);

        expect(create.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                expiredDate: new Date("9999-12-31T23:59:59.999Z"),
            }),
        );
    });

    it("keeps adoption successful when post-commit mirroring must be retried", async () => {
        const mirrorError = new Error("mirror failed");
        const createResult = {
            documentId: "doc-complete",
            warnings: ["client_link_failed" as const],
        };
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-complete",
                updated_date: 1_751_500_800_000,
                document_name: "완료 계약서",
                template: { id: "template-1", name: "표준 계약서" },
                current_status: {
                    status_type: "003",
                    status_doc_detail: "완료",
                    step_type: "05",
                    step_index: "1",
                    step_name: "완료",
                    step_recipients: [],
                    expired_date: 0,
                },
            }) } as never,
            { execute: jest.fn().mockResolvedValue(createResult) } as never,
            { findById: jest.fn().mockResolvedValue({ id: 7 }), findByPhone: jest.fn() } as never,
            { syncDocumentWithToken: jest.fn().mockRejectedValue(mirrorError) } as never,
            { findByDocumentId: jest.fn().mockResolvedValue(null) } as never,
        );

        await expect(usecase.execute("branch-1", {
            documentId: "doc-complete",
            clientId: 7,
        }, TEST_PRINCIPAL)).resolves.toMatchObject({
            documentId: "doc-complete",
            warnings: ["client_link_failed", "mirror_sync_failed"],
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("local mirror remains incomplete"));
        expect(warn.mock.calls.flat().join(" ")).not.toContain("will retry");
        expect(warn.mock.calls.flat().join(" ")).not.toContain("doc-complete");
        expect(warn.mock.calls.flat().join(" ")).not.toContain(mirrorError.message);
    });
});
