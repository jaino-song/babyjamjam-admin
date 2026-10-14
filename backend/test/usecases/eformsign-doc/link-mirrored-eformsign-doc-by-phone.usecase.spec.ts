import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";
import { extractEformsignContractClientCandidate } from "application/utils/eformsign-contract-client-candidate";
import { createKrBusinessDayCalendar, KOREAN_HOLIDAY_CALENDAR, KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { createHolidayCalendarStub } from "../../utils/holiday-calendar.stub";
import { createLifecycleTransactionProbe } from "../../utils/lifecycle-transaction-probe";

function contractDetail() {
    return {
        id: "doc-1",
        document_number: "DOC-1",
        template: { id: "contract-template", name: "계약서" },
        document_name: "산모신생아 건강관리 계약서",
        creator: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
        created_date: Date.parse("2026-07-20T00:00:00.000Z"),
        updated_date: Date.parse("2026-07-21T00:00:00.000Z"),
        current_status: {
            status_type: "072",
            step_type: "06",
            step_index: "3",
            step_name: "완료",
            step_recipients: [],
            step_group: 3,
        },
        fields: [
            { id: "이용자 성명", value: "김고객", type: "text" },
            { id: "이용자 주소", value: "서울시 중구", type: "text" },
            { id: "이용자 생년월일", value: "920304", type: "text" },
            { id: "계약 시작일", value: "2026-08-01", type: "date" },
            { id: "계약 종료일", value: "2026-08-14", type: "date" },
            { id: "서비스 비용", value: "1,500,000", type: "text" },
            { id: "정부지원금", value: "1,000,000", type: "text" },
            { id: "본인부담금", value: "500,000", type: "text" },
        ],
        recipients: [{
            recipient_type: "02",
            name: "김고객",
            sms: "010-1234-5678",
        }],
    };
}

function contractDetailWithProviders() {
    const detail = contractDetail();
    detail.fields = [
        ...detail.fields,
        { id: "제공인력 1 성명", value: "박관리사", type: "text" },
        { id: "제공인력 1 연락처", value: "010-5555-1111", type: "text" },
        { id: "제공인력 2 성명", value: "최관리사", type: "text" },
        { id: "제공인력 2 연락처", value: "01055552222", type: "text" },
    ];
    return detail;
}

function contractDetailWithoutDates() {
    const detail = contractDetail();
    detail.fields = detail.fields.filter(
        (field) => field.id !== "계약 시작일" && field.id !== "계약 종료일",
    );
    return detail;
}

function mirroredDocument(overrides: Record<string, unknown> = {}) {
    return {
        id: 11,
        documentId: "doc-1",
        documentKind: null,
        serviceRecordCaseId: null,
        templateId: "contract-template",
        templateName: null,
        stepRecipientSms: "고객 010-1234-5678",
        customerPhone: null,
        detailPayload: null,
        statusType: "072",
        branchId: null,
        clientId: null,
        createdDate: new Date("2026-07-20T00:00:00.000Z"),
        ...overrides,
    };
}

function expectedMirrorGeneration() {
    return {
        detailSourceUpdatedDate: new Date("2026-07-21T00:00:00.000Z"),
        detailSyncedAt: new Date("2026-07-21T00:01:00.000Z"),
    };
}

describe("LinkMirroredEformsignDocByPhoneUsecase", () => {
    function setup(document = mirroredDocument(), holidayCalendar = createHolidayCalendarStub()) {
        const transaction = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            $queryRaw: jest.fn().mockResolvedValue([{ id: 11 }]),
            eformsign_doc: {
                // D3 blocker query: no newer voided contract unless a test says so.
                findFirst: jest.fn().mockResolvedValue(null),
                updateMany: jest.fn().mockImplementation(async ({ data }) => {
                    Object.assign(document, data);
                    return { count: 1 };
                }),
                findUnique: jest.fn().mockImplementation(({ where }) =>
                    Promise.resolve(
                        where.documentId === document.documentId
                            ? document
                            : null,
                    )),
            },
            client: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 21,
                    branchId: "branch-1",
                    eDocId: null,
                }),
                findMany: jest.fn().mockResolvedValue([{
                    id: 21,
                    branchId: "branch-1",
                    phone: "010-1234-5678",
                    eDocId: null,
                    name: "김고객",
                    birthday: "1992-03-04",
                }]),
                create: jest.fn().mockResolvedValue({ id: 31 }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            message_trigger_rule: {
                upsert: jest.fn().mockResolvedValue(undefined),
            },
            message_trigger_job: {
                upsert: jest.fn().mockResolvedValue(undefined),
            },
            area: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            employee: {
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({ id: 71 }),
            },
            employee_schedule: {
                create: jest.fn().mockResolvedValue({ id: 91 }),
                // No active schedule overlaps by default, so the automatic
                // assignment path runs the real invariant check.
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{
                id: "automation-intent-1",
                scheduled_for: new Date("2026-07-21T00:02:00.000Z"),
            }]),
            client: {
                findUnique: jest.fn().mockResolvedValue({ name: "김고객" }),
            },
            user: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            branch: {
                findMany: jest.fn().mockResolvedValue([
                    { id: "branch-1" },
                ]),
                findUnique: jest.fn().mockResolvedValue({
                    smsSenderApprovalStatus: "approved",
                }),
            },
            message_trigger_job: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            eformsign_doc: {
                findUnique: jest.fn().mockResolvedValue(document),
            },
            $transaction: jest.fn((
                work: (tx: typeof transaction) => Promise<unknown>,
            ) => work(transaction)),
        };
        const config = {
            get: jest.fn().mockReturnValue(undefined),
        } as unknown as ConfigService;
        const settings = {
            getClientAutoRegistrationEnabled: jest.fn().mockResolvedValue(true),
            getGreetingOnAutoRegistrationEnabled: jest.fn().mockResolvedValue(false),
            getEformsignTemplateBranch: jest.fn().mockResolvedValue(null),
        };
        const messageTrigger = {
            ensureDefaultRulesForBranch: jest.fn().mockResolvedValue(undefined),
            syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
        };
        const serviceRecordLifecycle = {
            ensureForClient: jest.fn().mockResolvedValue(undefined),
            resolveCalendarBeforeTransaction: jest.fn().mockResolvedValue(undefined),
        };
        const notificationService = {
            sendToBranchUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
        };
        return {
            document,
            holidayCalendar,
            transaction,
            prisma,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            notificationService,
            usecase: new LinkMirroredEformsignDocByPhoneUsecase(
                prisma as never,
                config,
                settings as never,
                holidayCalendar, messageTrigger as never,
                serviceRecordLifecycle as never,
                notificationService as never,
            ),
        };
    }

    it.each([
        { name: "다른고객", birthday: "1992-03-04", knownClient: false, suppressed: false, autoRegistration: false },
        { name: "김고객", birthday: "1992-03-05", knownClient: false, suppressed: false, autoRegistration: false },
        { name: "김고객", birthday: null, knownClient: false, suppressed: false, autoRegistration: false },
        { name: "", birthday: "1992-03-04", knownClient: false, suppressed: false, autoRegistration: false },
        { name: "김고객", birthday: "invalid", knownClient: false, suppressed: false, autoRegistration: false },
        { name: "다른고객", birthday: "1992-03-04", knownClient: true, suppressed: false, autoRegistration: false },
        { name: "다른고객", birthday: "1992-03-04", knownClient: false, suppressed: true, autoRegistration: false },
        { name: "김고객", birthday: "1992-03-05", knownClient: false, suppressed: true, autoRegistration: true },
        { name: "다른고객", birthday: "1992-03-04", knownClient: false, suppressed: false, autoRegistration: true },
        { name: "김고객", birthday: "1992-03-05", knownClient: false, suppressed: false, autoRegistration: true },
    ])("requires confirmation without writes for $name/$birthday (known=$knownClient, suppressed=$suppressed, registration=$autoRegistration)", async ({ name, birthday, knownClient, suppressed, autoRegistration }) => {
        const { transaction, settings, serviceRecordLifecycle, notificationService, usecase } = setup(mirroredDocument({
            branchId: "branch-1", customerPhone: "01012345678", detailPayload: contractDetail(),
        }));
        settings.getClientAutoRegistrationEnabled.mockResolvedValue(autoRegistration);
        transaction.client.findMany.mockResolvedValue([{
            id: 21, branchId: "branch-1", phone: "010-1234-5678", eDocId: null, name, birthday,
        }]);

        await expect(usecase.execute("doc-1", {
            suppressOutboundAutomation: suppressed,
            ...(knownClient ? { existingClientId: 21, existingClientBranchId: "branch-1" } : {}),
        })).resolves.toBe("needs_confirmation");

        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
        expect(transaction.message_trigger_job.upsert).not.toHaveBeenCalled();
        if (suppressed) {
            expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        } else {
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                "branch-1", "계약서 연결 확인 필요",
                "전화번호가 같은 고객이 있지만 이름 또는 생년월일이 달라 계약서를 자동으로 연결하지 않았습니다.",
                {
                    type: "eformsign_link_confirmation_required",
                    documentId: "doc-1",
                    clientId: 21,
                    url: "/clients?id=21",
                },
                { dedupe: { type: "eformsign_link_confirmation_required", documentId: "doc-1" } },
            );
        }
    });

    it("requires confirmation when mirrored detail has no customer-qualified candidate", async () => {
        const detail = contractDetail();
        detail.fields = [];
        expect(extractEformsignContractClientCandidate(detail)).toBeNull();
        const { transaction, serviceRecordLifecycle, notificationService, usecase } = setup(mirroredDocument({
            branchId: "branch-1", customerPhone: "01012345678", detailPayload: detail,
        }));

        await expect(usecase.execute("doc-1")).resolves.toBe("needs_confirmation");

        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])("waits for detail before linking a single phone match without notifying (known=%s)", async (knownClient) => {
        const { transaction, serviceRecordLifecycle, notificationService, usecase } = setup(mirroredDocument({
            branchId: "branch-1", detailPayload: null,
        }));

        await expect(usecase.execute("doc-1", knownClient
            ? { existingClientId: 21, existingClientBranchId: "branch-1" }
            : undefined)).resolves.toBe("mirror_not_ready");

        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("compares transactional detail before taking client-link locks and logs only differing field names", async () => {
        const { transaction, serviceRecordLifecycle, notificationService, usecase } = setup(mirroredDocument({
            branchId: "branch-1", customerPhone: "01012345678", detailPayload: contractDetail(),
        }));
        const detail = contractDetail();
        detail.fields[0]!.value = "다른고객";
        detail.recipients[0]!.name = "다른고객";
        transaction.eformsign_doc.findUnique.mockResolvedValue(mirroredDocument({
            branchId: "branch-1", customerPhone: "01012345678", detailPayload: detail,
        }));
        Object.assign(transaction.employee_schedule, { findMany: jest.fn().mockResolvedValue([]) });
        Object.assign(transaction, { service_record_case: { findUnique: jest.fn().mockResolvedValue(null) } });
        const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
        try {
            await expect(usecase.execute("doc-1")).resolves.toBe("needs_confirmation");
            expect(transaction.$queryRaw).not.toHaveBeenCalled();
            expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(transaction.client.updateMany).not.toHaveBeenCalled();
            expect(transaction.client.create).not.toHaveBeenCalled();
            expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith({
                event: "eformsign_link_confirmation_required", fields: ["name"],
            });
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
        } finally {
            log.mockRestore();
        }
    });

    it("keeps needs_confirmation when its notification fails", async () => {
        const { transaction, notificationService, usecase } = setup(mirroredDocument({
            branchId: "branch-1", customerPhone: "01012345678", detailPayload: contractDetail(),
        }));
        transaction.client.findMany.mockResolvedValue([{
            id: 21, branchId: "branch-1", phone: "010-1234-5678", eDocId: null, name: "다른고객", birthday: "1992-03-04",
        }]);
        notificationService.sendToBranchUsers.mockRejectedValue(new Error("push unavailable"));
        await expect(usecase.execute("doc-1")).resolves.toBe("needs_confirmation");
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        { completeLocks: false, knownClient: false, retry: false },
        { completeLocks: true, knownClient: false, retry: false },
        { completeLocks: false, knownClient: true, retry: false },
        { completeLocks: true, knownClient: true, retry: false },
        { completeLocks: true, knownClient: false, retry: true },
        { completeLocks: true, knownClient: true, retry: true },
    ])("preloads the existing client's calendar outside the transaction ($completeLocks locks, $knownClient known, $retry retry)", async ({ completeLocks, knownClient, retry }) => {
        const probe = createLifecycleTransactionProbe({ clientId: 21 });
        const document = mirroredDocument({
            branchId: probe.branchId,
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, settings } = setup(document, probe.holidayCalendar);
        settings.getClientAutoRegistrationEnabled.mockResolvedValue(false);
        transaction.client.findMany.mockResolvedValue([{
            id: 21,
            branchId: probe.branchId,
            phone: "010-1234-5678",
            eDocId: null,
            name: "김고객",
            birthday: "1992-03-04",
        }]);
        transaction.client.findUnique.mockImplementation(async () => ({
            ...await probe.tables.client.findUnique(),
            eDocId: null,
        }));
        const tx = Object.assign(transaction, {
            service_record_case: probe.tables.service_record_case,
            service_record_token: probe.tables.service_record_token,
        });
        if (completeLocks) {
            Object.assign(tx.employee_schedule, { findMany: jest.fn().mockResolvedValue([]) });
        }
        if (retry) transaction.$executeRaw.mockRejectedValueOnce({ code: "P2034" });
        prisma.$transaction.mockImplementation(async (work) => {
            probe.state.open = true;
            try {
                return await work(tx);
            } finally {
                probe.state.open = false;
            }
        });
        const resolveCalendar = jest.spyOn(probe.lifecycle, "resolveCalendarBeforeTransaction");
        const usecase = new LinkMirroredEformsignDocByPhoneUsecase(
            prisma as never,
            { get: jest.fn() } as unknown as ConfigService,
            settings as never,
            probe.holidayCalendar,
            undefined,
            probe.lifecycle,
        );

        await expect(usecase.execute("doc-1", {
            ...(knownClient ? { existingClientId: 21, existingClientBranchId: probe.branchId } : {}),
            suppressOutboundAutomation: true,
        })).resolves.toBe("linked");

        expect(probe.state.forBranchWhileOpen).toEqual([false]);
        expect(probe.holidayCalendar.forBranch).toHaveBeenCalledWith(probe.branchId, { fresh: true });
        expect(probe.tables.service_record_case.upsert).toHaveBeenCalled();
        expect(prisma.$transaction).toHaveBeenCalledTimes(retry ? 2 : 1);
        if (knownClient) {
            expect(resolveCalendar).toHaveBeenCalledWith(21);
            expect(resolveCalendar).toHaveBeenCalledTimes(1);
        }
    });

    it("keeps an explicitly classified revision contract eligible when it carries a case scope", () => {
        const { usecase } = setup();
        const isServiceRecord = (usecase as unknown as {
            isServiceRecord: (document: {
                documentKind: string | null;
                serviceRecordCaseId: string | null;
                templateId: string | null;
            }) => boolean;
        }).isServiceRecord.bind(usecase);

        expect(isServiceRecord({
            documentKind: "contract",
            serviceRecordCaseId: "case-1",
            templateId: "contract-template",
        })).toBe(false);
        expect(isServiceRecord({
            documentKind: null,
            serviceRecordCaseId: "case-1",
            templateId: "contract-template",
        })).toBe(true);
    });

    it("rejects a malformed mirrored customer phone before auto-registration or linking", async () => {
        const document = mirroredDocument({
            customerPhone: "not-a-phone",
        });
        const { transaction, settings, usecase } = setup(document);

        const error: unknown = await usecase.execute("doc-1").catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            errors: expect.arrayContaining([
                expect.objectContaining({ pointer: "/phone", location: "body" }),
            ]),
        });

        expect(settings.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("waits for detail then claims a later-mirrored legacy document for the one exact phone and identity match", async () => {
        const { document, transaction, notificationService, usecase } = setup(mirroredDocument({ branchId: "branch-1" }));

        await expect(usecase.execute("doc-1")).resolves.toBe("mirror_not_ready");
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();

        Object.assign(document, { detailPayload: contractDetail() });

        await expect(usecase.execute("doc-1")).resolves.toBe("linked");

        expect(transaction.client.findMany).toHaveBeenCalledWith({
            where: {
                phone: { not: null },
                branchId: "branch-1",
                OR: [{ phone: { endsWith: "5678" } }],
            },
            select: {
                id: true,
                branchId: true,
                phone: true,
                eDocId: true,
                name: true,
                birthday: true,
            },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    branchId: "branch-1",
                    clientId: 21,
                    documentKind: "contract",
                },
            }),
        );
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
    });

    it("claims a branchless existing-client mirror when the observed source generation is current", async () => {
        const document = mirroredDocument({ branchId: null, clientId: null, detailPayload: contractDetail() });
        const { transaction, settings, usecase } = setup(document);
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-1",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        const tx = transaction as typeof transaction & {
            employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
            service_record_case: { findUnique: jest.Mock };
        };
        tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
        tx.service_record_case = {
            findUnique: jest.fn().mockResolvedValue(null),
        };
        transaction.$queryRaw.mockImplementation((query: { strings?: string[] }) => {
            const sql = query.strings?.join(" ").toLowerCase() ?? "";
            if (sql.includes("from eformsign_doc as doc")) {
                return Promise.resolve(
                    sql.includes("branch_id is null") || sql.includes("doc.branch_id =")
                        ? [{ id: 11 }]
                        : [],
                );
            }
            return Promise.resolve([{ id: 11 }]);
        });

        await expect(usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
            .resolves.toBe("linked");

        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    branchId: "branch-1",
                    clientId: 21,
                    documentKind: "contract",
                },
            }),
        );
    });

    it("does not link a client from another branch when a branchless document template has an owner", async () => {
        const { transaction, settings, usecase } = setup();
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        transaction.client.findMany.mockImplementation(({ where }) =>
            Promise.resolve(
                where.branchId === "branch-2"
                    ? []
                    : [{
                        id: 21,
                        branchId: "branch-1",
                        phone: "010-1234-5678",
                        eDocId: null,
                    }],
            ),
        );

        await expect(usecase.execute("doc-1")).resolves.toBe("no_match");

        expect(transaction.client.findMany).toHaveBeenCalledWith({
            where: {
                phone: { not: null },
                branchId: "branch-2",
                OR: [{ phone: { endsWith: "5678" } }],
            },
            select: {
                id: true,
                branchId: true,
                phone: true,
                eDocId: true,
                name: true,
                birthday: true,
            },
        });
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
    });

    it("links the matching client in the owning branch of a branchless document template", async () => {
        const { transaction, settings, usecase } = setup(mirroredDocument({ detailPayload: contractDetail() }));
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        transaction.client.findMany.mockImplementation(({ where }) =>
            Promise.resolve(
                where.branchId === "branch-2"
                    ? [{
                        id: 22,
                        branchId: "branch-2",
                        phone: "+82 10 1234 5678",
                        eDocId: null,
                        name: "김고객",
                        birthday: "1992-03-04",
                    }]
                    : [],
            ),
        );

        await expect(usecase.execute("doc-1")).resolves.toBe("linked");

        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    branchId: "branch-2",
                    clientId: 22,
                    documentKind: "contract",
                },
            }),
        );
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 22,
                branchId: "branch-2",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
    });

    it("uses the server-owned client scope for a client-initiated branchless link", async () => {
        const document = mirroredDocument({ branchId: null, clientId: null, detailPayload: contractDetail() });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([{
            id: 21,
            branchId: "branch-1",
            phone: "010-1234-5678",
            eDocId: null,
            name: "김고객",
            birthday: "1992-03-04",
        }]);

        await expect(usecase.execute("doc-1", {
            linkExistingOnly: true,
            existingClientId: 21,
            existingClientBranchId: "branch-1",
        })).resolves.toBe("linked");

        expect(transaction.client.findMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                phone: { not: null },
                branchId: "branch-1",
                OR: [{ phone: { endsWith: "5678" } }],
            },
            select: {
                id: true,
                branchId: true,
                phone: true,
                eDocId: true,
                name: true,
                birthday: true,
            },
        });
    });

    it("does not use a global phone lookup when a branchless document has no owner", async () => {
        const { transaction, settings, usecase } = setup();
        transaction.client.findMany.mockResolvedValue([{
            id: 21,
            branchId: "branch-1",
            phone: "010-1234-5678",
            eDocId: null,
        }]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(settings.getEformsignTemplateBranch)
            .toHaveBeenCalledWith("contract-template");
        expect(transaction.client.findMany).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
    });

    it("limits a completed-status mirror to an existing client without completion effects", async () => {
        const document = mirroredDocument({ statusType: "072", branchId: "branch-1", detailPayload: contractDetail() });
        const {
            transaction,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);

        await expect(usecase.execute("doc-1", {
            linkExistingOnly: true,
        })).resolves.toBe("linked");

        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    branchId: "branch-1",
                    clientId: 21,
                    documentKind: "contract",
                },
            }),
        );
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(settings.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(settings.getGreetingOnAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("does not guess when the normalized phone matches multiple clients", async () => {
        const { transaction, usecase } = setup(mirroredDocument({ branchId: "branch-1" }));
        transaction.client.findMany.mockResolvedValue([
            {
                id: 21,
                branchId: "branch-1",
                phone: "010-1234-5678",
                eDocId: null,
            },
            {
                id: 22,
                branchId: "branch-1",
                phone: "+82 10 1234 5678",
                eDocId: null,
            },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("ambiguous");
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    describe("another client still points at the unassigned document", () => {
        const arrange = (pointerReads: number[][], documentOverrides: Record<string, unknown> = {}) => {
            const document = mirroredDocument({ branchId: "branch-1", clientId: null, detailPayload: contractDetail(), ...documentOverrides });
            const { document: mirrored, transaction, usecase } = setup(document);
            const tx = transaction as typeof transaction & {
                employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
                service_record_case: { findUnique: jest.Mock };
            };
            tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
            tx.service_record_case = { findUnique: jest.fn().mockResolvedValue(null) };
            let reads = 0;
            transaction.$queryRaw.mockImplementation((query: { strings?: string[] }) => {
                const sql = query.strings?.join(" ").toLowerCase() ?? "";
                if (sql.includes("pointer_client")) {
                    const answer = pointerReads[Math.min(reads, pointerReads.length - 1)]!;
                    reads += 1;
                    return Promise.resolve(answer.map((id) => ({ id })));
                }
                return Promise.resolve([{ id: 11 }]);
            });
            return { document: mirrored, transaction, usecase };
        };
        const linkOnly = { linkExistingOnly: true, existingClientId: 21, existingClientBranchId: "branch-1" };

        it("releases the pointer holder even when the target keeps a newer contract's pointer (F1)", async () => {
            const { document, transaction, usecase } = arrange([[55]]);
            transaction.client.findUnique.mockResolvedValue({ id: 21, branchId: "branch-1", eDocId: "newer-doc" });
            transaction.client.findMany.mockResolvedValue([
                { id: 21, branchId: "branch-1", phone: "010-1234-5678", eDocId: "newer-doc", name: "김고객", birthday: "1992-03-04" },
            ]);
            transaction.eformsign_doc.findUnique.mockImplementation(({ where }) =>
                Promise.resolve(
                    where.documentId === document.documentId
                        ? document
                        : { createdDate: new Date("2026-07-21T00:00:00.000Z") },
                ));

            await expect(usecase.execute("doc-1", linkOnly, expectedMirrorGeneration()))
                .resolves.toBe("linked");

            // client 55 no longer points at the document the target now owns; the target keeps its pointer
            expect(transaction.client.updateMany.mock.calls).toEqual([
                [{
                    where: { id: { in: [55] }, branchId: "branch-1", eDocId: "doc-1" },
                    data: { eDocId: null },
                }],
            ]);
        });

        it("repairing a document the target already owns locks and releases the pointer holder (F2)", async () => {
            const { transaction, usecase } = arrange([[55]], { clientId: 21 });

            await expect(usecase.execute("doc-1", linkOnly, expectedMirrorGeneration()))
                .resolves.toBe("linked");

            const clientLocks = transaction.$queryRaw.mock.calls
                .map(([query]) => query as { strings: string[]; values: unknown[] })
                .filter((query) => {
                    const sql = query.strings.join(" ").toLowerCase();
                    return sql.includes("for update") && /from\s+client\b/.test(sql);
                });
            expect(clientLocks[0]!.values).toEqual([21, 55]);
            expect(transaction.client.updateMany.mock.calls).toEqual([
                [{
                    where: { id: { in: [55] }, branchId: "branch-1", eDocId: "doc-1" },
                    data: { eDocId: null },
                }],
                [{
                    where: { id: 21, branchId: "branch-1", eDocId: null },
                    data: { eDocId: "doc-1" },
                }],
            ]);
        });

        it("repairing an owned document fails closed when a new pointer client appears after the lock (F2)", async () => {
            const { transaction, usecase } = arrange([[55], [55, 77]], { clientId: 21 });

            await expect(usecase.execute("doc-1", linkOnly, expectedMirrorGeneration()))
                .resolves.toBe("mirror_not_ready");

            expect(transaction.client.updateMany).not.toHaveBeenCalled();
            expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        });

        it("locks the pointer client with the matched one, then releases it before taking the pointer", async () => {
            const { transaction, usecase } = arrange([[55]]);

            await expect(usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                .resolves.toBe("linked");

            const clientLocks = transaction.$queryRaw.mock.calls
                .map(([query]) => query as { strings: string[]; values: unknown[] })
                .filter((query) => {
                    const sql = query.strings.join(" ").toLowerCase();
                    return sql.includes("for update") && /from\s+client\b/.test(sql);
                });
            // The first client lock is the ascending-id pair, ahead of the service-record write set.
            expect(clientLocks[0]!.values).toEqual([21, 55]);
            expect(clientLocks[0]!.strings.join(" ")).toContain("ORDER BY id");
            expect(transaction.client.updateMany.mock.calls).toEqual([
                [{
                    where: { id: { in: [55] }, branchId: "branch-1", eDocId: "doc-1" },
                    data: { eDocId: null },
                }],
                [{
                    where: { id: 21, branchId: "branch-1", eDocId: null },
                    data: { eDocId: "doc-1" },
                }],
            ]);
        });

        it("never writes a pointer client that was not locked: starts over via the reconciler", async () => {
            // 55 was locked; 77 starts pointing at the document once it is locked.
            const { transaction, usecase } = arrange([[55], [55, 77]]);

            await expect(usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                .resolves.toBe("mirror_not_ready");

            expect(transaction.client.updateMany).not.toHaveBeenCalled();
            expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        });

        it("does not release anything when no other client points at it", async () => {
            const { transaction, usecase } = arrange([[]]);

            await expect(usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                .resolves.toBe("linked");

            expect(transaction.client.updateMany.mock.calls).toEqual([
                [{
                    where: { id: 21, branchId: "branch-1", eDocId: null },
                    data: { eDocId: "doc-1" },
                }],
            ]);
        });
    });

    it("keeps the client pointer on a newer contract", async () => {
        const { document, transaction, usecase } = setup(mirroredDocument({ branchId: "branch-1", detailPayload: contractDetail() }));
        transaction.client.findMany.mockResolvedValue([{
            id: 21,
            branchId: "branch-1",
            phone: "010-1234-5678",
            eDocId: "newer-doc",
            name: "김고객",
            birthday: "1992-03-04",
        }]);
        transaction.eformsign_doc.findUnique.mockImplementation(({ where }) =>
            Promise.resolve(
                where.documentId === document.documentId
                    ? document
                    : { createdDate: new Date("2026-07-21T00:00:00.000Z") },
            ));

        await expect(usecase.execute("doc-1")).resolves.toBe("linked");

        expect(transaction.client.updateMany).not.toHaveBeenCalled();
    });

    it("repairs an assigned mirror through the complete common lock order", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const { transaction, serviceRecordLifecycle, usecase } = setup(document);
        const tx = transaction as typeof transaction & {
            employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
            service_record_case: { findUnique: jest.Mock };
        };
        tx.employee_schedule.findMany = jest.fn().mockResolvedValue([{
            id: 91,
            primaryEmployeeId: 71,
            secondaryEmployeeId: 72,
        }]);
        tx.service_record_case = {
            findUnique: jest.fn().mockResolvedValue({
                id: "case-1",
                branchId: "branch-1",
                clientId: 21,
            }),
        };
        // No other client points at the document (the default double would report client 11).
        transaction.$queryRaw.mockImplementation((query: { strings?: string[] }) =>
            Promise.resolve(
                (query.strings?.join(" ").toLowerCase() ?? "").includes("pointer_client") ? [] : [{ id: 11 }],
            ));

        await expect(usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
            .resolves.toBe("linked");

        const lockTables = transaction.$queryRaw.mock.calls
            .map(([query]) => (query as { strings?: string[] }).strings?.join(" ").toLowerCase() ?? "")
            .filter((query) => query.includes("for update"))
            .map((query) => query.match(/from\s+"?([a-z_]+)"?/)?.[1] ?? "unknown");
        expect(lockTables.slice(0, 8)).toEqual([
            "client",
            "employee",
            "service_record_case",
            "employee_schedule",
            "service_record_assignment",
            "service_record_day",
            "eformsign_doc",
            "eformsign_doc",
        ]);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(21, transaction, undefined);
    });

    it("does not claim an older mirrored revision before document or client pointer writes", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
            serviceRecordCaseId: "case-1",
            revisionId: "revision-old",
        });
        const { transaction, usecase } = setup(document);
        const tx = transaction as typeof transaction & {
            employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
            service_record_case: { findUnique: jest.Mock };
        };
        tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
        tx.service_record_case = {
            findUnique: jest.fn().mockResolvedValue({
                id: "case-1",
                branchId: "branch-1",
                clientId: 21,
                currentRevisionId: "revision-current",
                currentUsableRevisionId: "revision-current",
                currentUsableDocumentVersion: 2,
            }),
        };

        const linkExistingClient = (usecase as unknown as {
            linkExistingClient: (
                transaction: unknown,
                document: unknown,
                client: unknown,
            ) => Promise<string>;
        }).linkExistingClient.bind(usecase);

        await expect(linkExistingClient(transaction, document, {
            id: 21,
            branchId: "branch-1",
            eDocId: "current-document",
        })).resolves.toBe("ambiguous");

        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
    });

    it("allows a mirrored document whose revision is the locked current case revision", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
            serviceRecordCaseId: "case-1",
            revisionId: "revision-current",
        });
        const { transaction, usecase } = setup(document);
        const tx = transaction as typeof transaction & {
            employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
            service_record_case: { findUnique: jest.Mock };
        };
        tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
        tx.service_record_case = {
            findUnique: jest.fn().mockResolvedValue({
                id: "case-1",
                branchId: "branch-1",
                clientId: 21,
                currentRevisionId: "revision-current",
                currentUsableRevisionId: "revision-current",
                currentUsableDocumentVersion: 2,
            }),
        };

        const linkExistingClient = (usecase as unknown as {
            linkExistingClient: (
                transaction: unknown,
                document: unknown,
                client: unknown,
            ) => Promise<string>;
        }).linkExistingClient.bind(usecase);

        await expect(linkExistingClient(transaction, document, {
            id: 21,
            branchId: "branch-1",
            eDocId: null,
        })).resolves.toBe("linked");

        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalled();
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
    });

    it("uses current revision identity to replace an older pointer even when its created date is later", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
            serviceRecordCaseId: "case-1",
            revisionId: "revision-current",
            createdDate: new Date("2026-07-01T00:00:00.000Z"),
        });
        const { transaction, usecase } = setup(document);
        const tx = transaction as typeof transaction & {
            employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
            service_record_case: { findUnique: jest.Mock };
        };
        tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
        tx.service_record_case = {
            findUnique: jest.fn().mockResolvedValue({
                id: "case-1",
                branchId: "branch-1",
                clientId: 21,
                currentRevisionId: "revision-current",
                currentUsableRevisionId: "revision-current",
                currentUsableDocumentVersion: 2,
            }),
        };
        transaction.eformsign_doc.findUnique.mockImplementation(({ where }) =>
            Promise.resolve(
                where.documentId === document.documentId
                    ? document
                    : {
                        createdDate: new Date("2026-08-01T00:00:00.000Z"),
                        revisionId: "revision-old",
                        serviceRecordCaseId: "case-1",
                        branchId: "branch-1",
                        clientId: 21,
                    },
            ));

        const linkExistingClient = (usecase as unknown as {
            linkExistingClient: (
                transaction: unknown,
                document: unknown,
                client: unknown,
            ) => Promise<string>;
        }).linkExistingClient.bind(usecase);

        await expect(linkExistingClient(transaction, document, {
            id: 21,
            branchId: "branch-1",
            eDocId: "older-document",
        })).resolves.toBe("linked");

        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: "older-document",
            },
            data: { eDocId: "doc-1" },
        });
    });

    it("repairs the client contract pointer for an already assigned document", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const { transaction, serviceRecordLifecycle, usecase } = setup(document);

        await expect(usecase.execute("doc-1")).resolves.toBe("linked");

        expect(transaction.client.findUnique).toHaveBeenCalledWith({
            where: { id: 21 },
            select: {
                id: true,
                branchId: true,
                eDocId: true,
            },
        });
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(21, transaction, undefined);
    });

    it("does not initialize lifecycle when an assigned mirror repair is ambiguous", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const { transaction, serviceRecordLifecycle, usecase } = setup(document);
        transaction.client.findUnique.mockResolvedValueOnce({
            id: 21,
            branchId: null,
            eDocId: null,
        });

        const repairAssignedDocument = (usecase as unknown as {
            repairAssignedDocument: (
                document: unknown,
                expectedMirrorGeneration?: unknown,
                initializeLifecycle?: boolean,
            ) => Promise<string>;
        }).repairAssignedDocument.bind(usecase);

        await expect(repairAssignedDocument({
            id: document.id,
            documentId: document.documentId,
            branchId: document.branchId,
            clientId: document.clientId,
            serviceRecordCaseId: document.serviceRecordCaseId,
            revisionId: null,
            createdDate: document.createdDate,
        })).resolves.toBe("ambiguous");

        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("does not repair an assigned document after the expected mirror generation loses its fence", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const {
            transaction,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.$queryRaw.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            {
                detailSourceUpdatedDate: new Date("2026-07-21T00:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-21T00:01:00.000Z"),
            },
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.client.findUnique).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("creates a client once from a completed, branch-owned contract", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            prisma,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(settings.getClientAutoRegistrationEnabled).toHaveBeenCalledWith("branch-1");
        expect(settings.getGreetingOnAutoRegistrationEnabled).toHaveBeenCalledWith("branch-1");
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: "김고객",
                phone: "010-1234-5678",
                address: "서울시 중구",
                birthday: "1992-03-04",
                branchId: "branch-1",
                eDocId: "doc-1",
                suppressGreetingSms: true,
                voucherClient: true,
                serviceStatus: "pre_booking",
                bookingConfirmedAt: null,
            }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: {
                id: 11,
                branchId: "branch-1",
                clientId: null,
            },
            data: {
                branchId: "branch-1",
                clientId: 31,
                documentKind: "contract",
                customerPhone: "01012345678",
                autoRegisteredClient: true,
            },
        });
        expect(transaction.message_trigger_rule.upsert).toHaveBeenCalledTimes(1);
        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    branchId: "branch-1",
                    clientId: 31,
                    ruleId: "system:message_automation_intent",
                    status: "failed",
                }),
            }),
        );
        expect(messageTrigger.ensureDefaultRulesForBranch)
            .toHaveBeenCalledWith("branch-1");
        expect(messageTrigger.syncClientRulesForClient)
            .toHaveBeenCalledWith(
                "branch-1",
                31,
                true,
                true,
                {
                    stableBatchAt: new Date("2026-07-21T00:02:00.000Z"),
                    preserveExisting: true,
                },
            );
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                id: "automation-intent-1",
                ruleId: "system:message_automation_intent",
            }),
        });
        expect(serviceRecordLifecycle.ensureForClient)
            .toHaveBeenCalledWith(31, expect.anything(), KR_BUILTIN_CALENDAR);
    });

    it("derives the created client's duration from the creating branch's calendar, loaded fresh", async () => {
        // 2026-08-01..14 holds 10 business days; the branch adds 2026-08-12 off.
        const holidayCalendar = createHolidayCalendarStub();
        const branchCalendar = createKrBusinessDayCalendar(
            [...(KOREAN_HOLIDAY_CALENDAR[2026] ?? []), "2026-08-12"],
            { supportedYears: [2026], version: "branch-test" },
        );
        (holidayCalendar.forBranch as jest.Mock).mockResolvedValue(branchCalendar);
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, usecase, prisma, serviceRecordLifecycle } = setup(document, holidayCalendar);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(holidayCalendar.forBranch).toHaveBeenCalledWith("branch-1", { fresh: true });
        // Read once, before the serializable transaction opens, and handed to the lifecycle repair.
        expect(holidayCalendar.forBranch).toHaveBeenCalledTimes(1);
        expect((holidayCalendar.forBranch as jest.Mock).mock.invocationCallOrder[0]!)
            .toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]!);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(31, transaction, branchCalendar);
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ duration: 9 }),
            select: { id: true },
        });
    });

    it("auto-registers a branchless contract only after the observed generation and ownership fence", async () => {
        const document = mirroredDocument({
            branchId: null,
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            templateId: "contract-template",
        });
        const {
            transaction,
            settings,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        const tx = transaction as typeof transaction & {
            employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
            service_record_case: { findUnique: jest.Mock };
        };
        tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
        tx.service_record_case = {
            findUnique: jest.fn().mockResolvedValue(null),
        };
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-1",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        transaction.$queryRaw.mockImplementation((query: { strings?: string[] }) => {
            const sql = query.strings?.join(" ").toLowerCase() ?? "";
            if (sql.includes("from eformsign_doc as doc")) {
                return Promise.resolve(
                    sql.includes("branch_id is null") || sql.includes("doc.branch_id =")
                        ? [{ id: 11 }]
                        : [],
                );
            }
            return Promise.resolve([{ id: 11 }]);
        });

        await expect(usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
            .resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ branchId: "branch-1" }),
        }));
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ branchId: null, clientId: null }),
            data: expect.objectContaining({ branchId: "branch-1", clientId: 31 }),
        }));
    });

    it("resolves the area from the contract template name", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            templateName: "인천 아이미래로 남동구 계약서",
            detailPayload: contractDetail(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.area.findMany.mockResolvedValue([
            { id: "seogu", koreanName: "서구", branchId: null },
            { id: "namdong", koreanName: "남동구", branchId: "branch-1" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.area.findMany).toHaveBeenCalledWith({
            where: { OR: [{ branchId: "branch-1" }, { branchId: null }] },
            select: { id: true, koreanName: true, branchId: true },
        });
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ areaId: "namdong" }),
            select: { id: true },
        });
    });

    it("keeps the area empty when the template name matches no area", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            templateName: "인천 아이미래로 남동구 계약서",
            detailPayload: contractDetail(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.area.findMany.mockResolvedValue([
            { id: "bupyeong", koreanName: "부평구", branchId: "branch-1" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ areaId: null }),
            select: { id: true },
        });
    });

    it("assigns contract caretakers by phone match and persists both automation intents", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([
            { id: 55, name: "박관리사", phone: "010-5555-1111" },
            { id: 56, name: "최관리사", phone: "01055552222" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee.create).not.toHaveBeenCalled();
        expect(transaction.employee_schedule.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                primaryEmployeeId: 55,
                secondaryEmployeeId: 56,
                workAddress: "서울시 중구",
                clientId: 31,
                branchId: "branch-1",
            }),
            select: { id: true },
        });
        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledTimes(2);
        expect(transaction.message_trigger_job.upsert).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                create: expect.objectContaining({ employeeScheduleId: 91 }),
            }),
        );
    });

    it("creates missing caretakers from the contract before assigning them", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([]);
        transaction.employee.create
            .mockResolvedValueOnce({ id: 71 })
            .mockResolvedValueOnce({ id: 72 });

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee.create).toHaveBeenNthCalledWith(1, {
            data: expect.objectContaining({
                name: "박관리사",
                phone: "010-5555-1111",
                workArea: ["미지정"],
                grade: "스탠다드",
                openToNextWork: true,
                branchId: "branch-1",
            }),
            select: { id: true },
        });
        expect(transaction.employee_schedule.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                primaryEmployeeId: 71,
                secondaryEmployeeId: 72,
            }),
            select: { id: true },
        });
    });

    it("stores the canonical phone on a caretaker it auto-creates", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        // phone_normalized carries the uniqueness constraint and every phone
        // lookup; a null here would hide the row from both.
        expect(transaction.employee.create).toHaveBeenNthCalledWith(1, {
            data: expect.objectContaining({
                phone: "010-5555-1111",
                phoneNormalized: "01055551111",
            }),
            select: { id: true },
        });
    });

    it("skips the automatic assignment when it would double-book a caretaker", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([]);
        transaction.employee_schedule.findFirst.mockResolvedValue({
            id: 55,
            clientId: 12,
            primaryEmployeeId: 71,
            secondaryEmployeeId: null,
        });

        // The conflict skips the assignment; the client is still registered.
        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee_schedule.create).not.toHaveBeenCalled();
        expect(transaction.client.create).toHaveBeenCalled();
    });

    it("skips caretaker assignment when the contract has no service dates", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithoutDates(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee.findMany).not.toHaveBeenCalled();
        expect(transaction.employee_schedule.create).not.toHaveBeenCalled();
        expect(transaction.client.create).toHaveBeenCalled();
    });

    it("notifies staff when an auto-registered client has no caretaker assignment", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee_schedule.create).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
            "branch-1",
            "제공인력 지정 필요",
            "김고객 산모님의 제공인력 지정이 필요합니다.",
            expect.objectContaining({
                type: "eformsign_assignment_required",
                documentId: "doc-1",
                clientId: 31,
                url: "/clients?id=31",
            }),
            expect.objectContaining({
                dedupe: expect.objectContaining({
                    type: "eformsign_assignment_required",
                    documentId: "doc-1",
                }),
            }),
        );
    });

    it("does not notify when caretakers were assigned during registration", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([
            { id: 55, name: "박관리사", phone: "010-5555-1111" },
            { id: 56, name: "최관리사", phone: "01055552222" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee_schedule.create).toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("does not notify for historical imports with suppressed automation", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1", {
            suppressOutboundAutomation: true,
        })).resolves.toBe("created");

        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("keeps the registration successful when the assignment notification fails", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        notificationService.sendToBranchUsers.mockRejectedValue(new Error("push provider down"));

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalled();
    });

    it("does not create a client for a completed mirror in existing-only mode", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1", {
            linkExistingOnly: true,
        })).resolves.toBe("disabled");

        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(settings.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(settings.getGreetingOnAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(transaction.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(transaction.message_trigger_job.upsert).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("does not initialize lifecycle while repairing an assigned mirror in existing-only mode", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const { serviceRecordLifecycle, usecase } = setup(document);

        await expect(usecase.execute("doc-1", {
            linkExistingOnly: true,
        })).resolves.toBe("linked");

        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("creates and initializes a historical client without outbound automation", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        settings.getGreetingOnAutoRegistrationEnabled.mockResolvedValue(true);

        await expect(usecase.execute("doc-1", {
            suppressOutboundAutomation: true,
        })).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-1",
                eDocId: "doc-1",
                suppressGreetingSms: true,
            }),
            select: { id: true },
        });
        expect(settings.getGreetingOnAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(transaction.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(transaction.message_trigger_job.upsert).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(31, expect.anything(), KR_BUILTIN_CALENDAR);
    });

    it("retries a raw PostgreSQL serialization conflict from the mirror fence", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, prisma, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        let transactionAttempts = 0;
        prisma.$transaction.mockImplementation(async (
            work: (candidate: typeof transaction) => Promise<unknown>,
        ) => {
            transactionAttempts += 1;
            if (transactionAttempts === 1) {
                throw {
                    code: "P2010",
                    meta: {
                        code: "40001",
                    },
                };
            }
            return work(transaction);
        });

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transactionAttempts).toBe(2);
        expect(transaction.client.create).toHaveBeenCalledTimes(1);
    });

    it("does not mutate a stale mirror generation after the parent-row fence loses", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.$queryRaw.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            {
                detailSourceUpdatedDate: new Date("2026-07-21T00:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-21T00:01:00.000Z"),
            },
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
        const [fenceQuery] = transaction.$queryRaw.mock.calls[0];
        expect(fenceQuery.strings.join(" ")).toContain("FOR UPDATE");
        expect(fenceQuery.strings.join(" ")).toContain("eformsign_doc_file");
        expect(fenceQuery.strings.join(" "))
            .toContain("permanent_purge_requested_at IS NULL");
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("locks a partial detail generation without requiring final files", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType: "020",
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.$queryRaw.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            {
                ...expectedMirrorGeneration(),
                readiness: "detail",
            },
        )).resolves.toBe("mirror_not_ready");

        const [fenceQuery] = transaction.$queryRaw.mock.calls[0];
        const sql = fenceQuery.strings.join(" ");
        expect(sql).toContain("detail_payload IS NOT NULL");
        expect(sql).toContain("permanent_purge_requested_at IS NULL");
        expect(sql).not.toContain("sync_status = 'ready'");
        expect(sql).not.toContain("eformsign_doc_file");
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("keeps assigned-link lifecycle inside its owning transaction when the post-link generation recheck loses", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const {
            transaction,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.$queryRaw
            .mockResolvedValueOnce([{ id: 11 }])
            .mockResolvedValueOnce([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
        expect(transaction.client.updateMany).toHaveBeenCalledTimes(1);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(
            21,
            transaction,
            undefined,
        );
    });

    it("keeps created-link lifecycle in the owning transaction when the post-link generation recheck loses", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.$queryRaw
            .mockResolvedValueOnce([{ id: 11 }])
            .mockResolvedValueOnce([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.client.create).toHaveBeenCalledTimes(1);
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(
            31,
            transaction,
            KR_BUILTIN_CALENDAR,
        );
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
    });

    it("rolls back a full-surface client and schedule when the expected generation changes", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const {
            transaction,
            prisma,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        const tx = transaction as typeof transaction & {
            employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
            service_record_case: { findUnique: jest.Mock };
        };
        let createdClientId: number | null = null;
        let createdScheduleId: number | null = null;
        let claimedDocument = false;
        tx.employee_schedule.findMany = jest.fn().mockImplementation(async () => (
            createdScheduleId === null
                ? []
                : [{ id: createdScheduleId, primaryEmployeeId: 55, secondaryEmployeeId: 56 }]
        ));
        tx.service_record_case = {
            findUnique: jest.fn().mockResolvedValue(null),
        };
        tx.employee.findMany.mockResolvedValue([
            { id: 55, name: "박관리사", phone: "010-5555-1111" },
            { id: 56, name: "최관리사", phone: "01055552222" },
        ]);
        tx.client.create.mockImplementation(async () => {
            createdClientId = 31;
            return { id: 31 };
        });
        tx.employee_schedule.create.mockImplementation(async () => {
            createdScheduleId = 91;
            return { id: 91 };
        });
        tx.client.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => ({
            id: where.id,
            branchId: "branch-1",
            eDocId: "doc-1",
        }));
        tx.eformsign_doc.updateMany.mockImplementation(async () => {
            claimedDocument = true;
            return { count: 1 };
        });
        tx.$queryRaw.mockImplementation(async (query: { strings?: string[] }) => {
            const sql = query.strings?.join(" ") ?? "";
            return sql.includes("detail_source_updated_date") ? [] : [{ id: 11 }];
        });
        // Prisma rolls back the callback's writes when the generation sentinel
        // is thrown. Keep a tiny state snapshot in the unit double so this test
        // proves the stale result cannot leave a client, schedule, or claim.
        prisma.$transaction.mockImplementation(async (
            work: (candidate: typeof transaction) => Promise<unknown>,
        ) => {
            const snapshot = {
                createdClientId,
                createdScheduleId,
                claimedDocument,
            };
            try {
                return await work(transaction);
            } catch (error) {
                createdClientId = snapshot.createdClientId;
                createdScheduleId = snapshot.createdScheduleId;
                claimedDocument = snapshot.claimedDocument;
                throw error;
            }
        });
        tx.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
            .resolves.toBe("mirror_not_ready");

        expect(createdClientId).toBeNull();
        expect(createdScheduleId).toBeNull();
        expect(claimedDocument).toBe(false);
        expect(tx.client.create).toHaveBeenCalledTimes(1);
        expect(tx.employee_schedule.create).toHaveBeenCalledTimes(1);
        expect(tx.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(31, transaction, KR_BUILTIN_CALENDAR);
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
    });

    it("runs created-link lifecycle and message automation while the second generation lock is held", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).resolves.toBe("created");

        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(
            31,
            transaction,
            KR_BUILTIN_CALENDAR,
        );
        expect(messageTrigger.ensureDefaultRulesForBranch)
            .toHaveBeenCalledWith("branch-1");
        expect(messageTrigger.syncClientRulesForClient)
            .toHaveBeenCalledWith(
                "branch-1",
                31,
                true,
                true,
                {
                    stableBatchAt: new Date("2026-07-21T00:02:00.000Z"),
                    preserveExisting: true,
                },
            );
    });

    it("propagates an expected-generation lifecycle failure so completion can retry", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        serviceRecordLifecycle.ensureForClient.mockRejectedValue(new Error("lifecycle unavailable"));

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).rejects.toThrow("lifecycle unavailable");

        expect(transaction.client.create).toHaveBeenCalledTimes(1);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
    });

    it("does not create a client when branch auto-registration is disabled", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType: "002",
        });
        const { transaction, settings, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        settings.getClientAutoRegistrationEnabled.mockResolvedValue(false);

        await expect(usecase.execute("doc-1")).resolves.toBe("disabled");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("creates a client for a branchless contract when exactly one active branch enables auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            settings,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(settings.getClientAutoRegistrationEnabled)
            .toHaveBeenCalledWith("branch-1");
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-1",
                eDocId: "doc-1",
            }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: {
                id: 11,
                branchId: null,
                clientId: null,
            },
            data: {
                branchId: "branch-1",
                clientId: 31,
                autoRegisteredClient: true,
                documentKind: "contract",
                customerPhone: "01012345678",
            },
        });
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(31, expect.anything(), KR_BUILTIN_CALENDAR);
    });

    it("uses only an explicitly active global branch for auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        const candidates = [
            { id: "branch-null", isActive: null },
            { id: "branch-false", isActive: false },
            { id: "branch-true", isActive: true },
        ];
        prisma.branch.findMany.mockImplementation(({ where }) =>
            Promise.resolve(
                candidates
                    .filter((branch) => branch.isActive === where.isActive)
                    .map(({ id }) => ({ id })),
            ),
        );
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(prisma.branch.findMany).toHaveBeenCalledWith({
            where: { isActive: true },
            select: { id: true },
        });
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-true" }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ branchId: "branch-true" }),
            }),
        );
    });

    it("does not auto-register or link from null or false global branch candidates", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        const candidates = [
            { id: "branch-null", isActive: null },
            { id: "branch-false", isActive: false },
        ];
        prisma.branch.findMany.mockImplementation(({ where }) =>
            Promise.resolve(
                candidates
                    .filter((branch) => branch.isActive === where.isActive)
                    .map(({ id }) => ({ id })),
            ),
        );
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(prisma.branch.findMany).toHaveBeenCalledWith({
            where: { isActive: true },
            select: { id: true },
        });
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("does not guess a branch when multiple active branches enable auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        prisma.branch.findMany.mockResolvedValue([
            { id: "branch-1" },
            { id: "branch-2" },
        ]);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("resolves a branchless contract from the branch its template is registered to", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, settings, usecase } = setup(document);
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(settings.getEformsignTemplateBranch)
            .toHaveBeenCalledWith("contract-template");
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-2" }),
            select: { id: true },
        });
        // The template answered, so the creator-membership fallback never runs.
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it("leaves a contract created before its template mapping took effect unregistered", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            createdDate: new Date("2026-06-30T23:59:59.000Z"),
        });
        const { prisma, transaction, settings, usecase } = setup(document);
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        prisma.user.findFirst.mockResolvedValue({
            ownedBranches: [],
            userBranches: [],
        });
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(settings.getEformsignTemplateBranch)
            .toHaveBeenCalledWith("contract-template");
        // Out of window means fall through to the creator fallback, not short-circuit.
        expect(prisma.user.findFirst).toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("does not auto-register through a template mapping to a branch that disabled it", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, settings, usecase } = setup(document);
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        settings.getClientAutoRegistrationEnabled.mockResolvedValue(false);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("disabled");

        expect(settings.getClientAutoRegistrationEnabled)
            .toHaveBeenCalledWith("branch-2");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("resolves a branchless contract from the eformsign creator's one branch membership", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        prisma.user.findFirst.mockResolvedValue({
            ownedBranches: [],
            userBranches: [{ branch: { id: "branch-2" } }],
        });
        prisma.branch.findMany.mockResolvedValue([
            { id: "branch-1" },
            { id: "branch-2" },
        ]);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-2" }),
            select: { id: true },
        });
        expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it("uses only an explicitly active creator membership for auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        const candidates = [
            { id: "branch-null", isActive: null },
            { id: "branch-false", isActive: false },
            { id: "branch-true", isActive: true },
        ];
        prisma.user.findFirst.mockImplementation(({ select }) =>
            Promise.resolve({
                ownedBranches: candidates
                    .filter(
                        (branch) =>
                            branch.isActive
                            === select.ownedBranches.where.isActive,
                    )
                    .map(({ id }) => ({ id })),
                userBranches: candidates
                    .filter(
                        (branch) =>
                            branch.isActive
                            === select.userBranches.where.branch.isActive,
                    )
                    .map(({ id }) => ({ branch: { id } })),
            }),
        );
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(prisma.user.findFirst).toHaveBeenCalledWith({
            where: {
                email: {
                    equals: "staff@example.com",
                    mode: "insensitive",
                },
            },
            select: {
                ownedBranches: {
                    where: { isActive: true },
                    select: { id: true },
                },
                userBranches: {
                    where: { branch: { isActive: true } },
                    select: { branch: { select: { id: true } } },
                },
            },
        });
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-true" }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ branchId: "branch-true" }),
            }),
        );
        expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it("fails closed when a known eformsign creator has no active branch candidates", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        prisma.user.findFirst.mockResolvedValue({
            ownedBranches: [],
            userBranches: [],
        });
        prisma.branch.findMany.mockResolvedValue([{ id: "branch-1" }]);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(prisma.branch.findMany).not.toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("does not create a client when the contract service period is inverted", async () => {
        const detail = contractDetail();
        detail.fields = detail.fields?.map((field) => {
            if (field.id === "계약 시작일") {
                return { ...field, value: "2026-08-20" };
            }
            if (field.id === "계약 종료일") {
                return { ...field, value: "2026-08-14" };
            }
            return field;
        });
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: detail,
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("skipped");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it.each([
        "002",
        "010",
        "020",
        "030",
        // 041 (doc_refuse_revoke): a refused revoke continues exactly like 060.
        "041",
        "043",
        "060",
        "062",
        "063",
        "064",
        "070",
    ])("creates a client from document creation onward at status %s", async (statusType) => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType,
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");
        expect(transaction.client.create).toHaveBeenCalledTimes(1);
    });

    it("does not create a client from a temporary save", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType: "001",
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("not_completed");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it.each(["011", "042", "080"])(
        "does not create a client from terminal-negative status %s",
        async (statusType) => {
            const document = mirroredDocument({
                branchId: "branch-1",
                customerPhone: "01012345678",
                detailPayload: contractDetail(),
                statusType,
            });
            const { transaction, usecase } = setup(document);
            transaction.client.findMany.mockResolvedValue([]);

            await expect(usecase.execute("doc-1")).resolves.toBe("not_completed");
            expect(transaction.client.create).not.toHaveBeenCalled();
        },
    );

    // 계약-05: 040 / 045 / 071 may be linked to an EXISTING client (see the
    // describe block below) but must never register a NEW one. The two gates
    // that enforce this are the status check before the transaction (decides
    // whether creation is permitted at all) and the status check on the row
    // read inside the transaction (decides whether to create).
    describe("계약-05: 040 / 045 / 071 never auto-register a new client", () => {
        const linkOnlyStatuses = ["040", "045", "071"];

        it.each(linkOnlyStatuses)(
            "does not create a client or touch the document at status %s",
            async (statusType) => {
                const document = mirroredDocument({
                    branchId: "branch-1",
                    customerPhone: "01012345678",
                    detailPayload: contractDetail(),
                    statusType,
                });
                const { transaction, settings, usecase } = setup(document);
                transaction.client.findMany.mockResolvedValue([]);

                await expect(usecase.execute("doc-1")).resolves.toBe("not_completed");

                expect(transaction.client.create).not.toHaveBeenCalled();
                expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
                // Creation was never permitted, so the greeting setting that is
                // read only for a creatable document is not consulted either.
                expect(settings.getGreetingOnAutoRegistrationEnabled).not.toHaveBeenCalled();
            },
        );

        it.each(linkOnlyStatuses)(
            "refuses at status %s even when the status read before the transaction was a creating one",
            async (statusType) => {
                // Before the transaction the document looked creatable (060), so creation
                // was permitted; the row read inside the transaction has moved to
                // the link-only status and must still not create.
                const before = mirroredDocument({
                    branchId: "branch-1",
                    customerPhone: "01012345678",
                    detailPayload: contractDetail(),
                    statusType: "060",
                });
                const inside = { ...before, statusType };
                const { prisma, transaction, usecase } = setup(inside);
                prisma.eformsign_doc.findUnique.mockResolvedValue(before);
                transaction.client.findMany.mockResolvedValue([]);

                await expect(usecase.execute("doc-1")).resolves.toBe("not_completed");

                expect(transaction.client.create).not.toHaveBeenCalled();
                expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
            },
        );

        it.each(linkOnlyStatuses)(
            "does not create when the status read before the transaction is %s even if the row inside it is a creating status",
            async (statusType) => {
                // The pre-transaction status alone must withhold creation permission.
                const before = mirroredDocument({
                    branchId: "branch-1",
                    customerPhone: "01012345678",
                    detailPayload: contractDetail(),
                    statusType,
                });
                const inside = { ...before, statusType: "060" };
                const { prisma, transaction, usecase } = setup(inside);
                prisma.eformsign_doc.findUnique.mockResolvedValue(before);
                transaction.client.findMany.mockResolvedValue([]);

                await expect(usecase.execute("doc-1")).resolves.toBe("disabled");

                expect(transaction.client.create).not.toHaveBeenCalled();
                expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
            },
        );
    });

    describe("voided (파기) contract: no client pointer, assignment, auto-registration or lifecycle", () => {
        const voidedAt = new Date("2026-10-01T00:00:00.000Z");

        /** The complete service-record lock surface, so the locked path runs. */
        const withLockSurface = (transaction: ReturnType<typeof setup>["transaction"]) => {
            const tx = transaction as typeof transaction & {
                employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
                service_record_case: { findUnique: jest.Mock };
            };
            tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
            tx.service_record_case = { findUnique: jest.fn().mockResolvedValue(null) };
            // No other client points at the document (the default double would report client 11).
            transaction.$queryRaw.mockImplementation((query: { strings?: string[] }) =>
                Promise.resolve(
                    (query.strings?.join(" ").toLowerCase() ?? "").includes("pointer_client") ? [] : [{ id: 11 }],
                ));
        };

        const expectNothingWritten = (
            { transaction, serviceRecordLifecycle }: Pick<ReturnType<typeof setup>, "transaction" | "serviceRecordLifecycle">,
        ) => {
            expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(transaction.client.updateMany).not.toHaveBeenCalled();
            expect(transaction.client.create).not.toHaveBeenCalled();
            expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
        };

        const assignedDocument = (overrides: Record<string, unknown> = {}) =>
            mirroredDocument({ branchId: "branch-1", clientId: 21, ...overrides });

        const completedUnassigned = (overrides: Record<string, unknown> = {}) =>
            mirroredDocument({
                branchId: "branch-1",
                customerPhone: "01012345678",
                detailPayload: contractDetail(),
                ...overrides,
            });

        describe.each([
            ["plain path", false],
            ["lock-surface path", true],
        ])("assigned document, %s", (_label, lockSurface) => {
            it("leaves a null client pointer untouched and skips lifecycle for a voided document", async () => {
                const arranged = setup(assignedDocument({ voidedAt }));
                if (lockSurface) withLockSurface(arranged.transaction);

                await expect(arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                    .resolves.toBe("skipped");

                expect(arranged.prisma.$transaction).not.toHaveBeenCalled();
                expectNothingWritten(arranged);
            });

            it("still repairs the pointer of a live document (control)", async () => {
                const arranged = setup(assignedDocument());
                if (lockSurface) withLockSurface(arranged.transaction);

                await expect(arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                    .resolves.toBe("linked");

                expect(arranged.transaction.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 21, branchId: "branch-1", eDocId: null },
                    data: { eDocId: "doc-1" },
                });
                expect(arranged.serviceRecordLifecycle.ensureForClient).toHaveBeenCalledTimes(1);
            });
        });

        it("re-checks the void state in the row re-read under the document lock (assigned repair)", async () => {
            const live = assignedDocument();
            const arranged = setup(live);
            withLockSurface(arranged.transaction);
            // The unlocked read saw a live row; the row re-read under the lock is voided.
            arranged.transaction.eformsign_doc.findUnique.mockResolvedValue({ ...live, voidedAt });

            await expect(arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                .resolves.toBe("skipped");

            expect(arranged.prisma.$transaction).toHaveBeenCalledTimes(1);
            expectNothingWritten(arranged);
        });

        describe.each([
            ["plain path", false],
            ["lock-surface path", true],
        ])("unassigned document, %s", (_label, lockSurface) => {
            it("neither links an existing client nor auto-registers one for a voided document whose clientId is null", async () => {
                const arranged = setup(completedUnassigned({ voidedAt }));
                if (lockSurface) withLockSurface(arranged.transaction);

                await expect(arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                    .resolves.toBe("skipped");

                expect(arranged.prisma.$transaction).not.toHaveBeenCalled();
                expect(arranged.settings.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
                expectNothingWritten(arranged);
                expect(arranged.notificationService.sendToBranchUsers).not.toHaveBeenCalled();
            });

            it("links the matching existing client of a live document (control)", async () => {
                const arranged = setup(completedUnassigned());
                if (lockSurface) withLockSurface(arranged.transaction);

                await expect(arranged.usecase.execute("doc-1")).resolves.toBe("linked");

                expect(arranged.transaction.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 21, branchId: "branch-1", eDocId: null },
                    data: { eDocId: "doc-1" },
                });
            });

            it("auto-registers a client for a live document when none matches (control)", async () => {
                const arranged = setup(completedUnassigned());
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.client.findMany.mockResolvedValue([]);

                await expect(arranged.usecase.execute("doc-1")).resolves.toBe("created");

                expect(arranged.transaction.client.create).toHaveBeenCalledTimes(1);
            });

            it("writes nothing when the row became voided before the transaction's own read", async () => {
                const live = completedUnassigned();
                const arranged = setup(live);
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.client.findMany.mockResolvedValue([]);
                arranged.transaction.eformsign_doc.findUnique.mockResolvedValue({ ...live, voidedAt });

                await expect(arranged.usecase.execute("doc-1")).resolves.toBe("skipped");

                expectNothingWritten(arranged);
            });
        });

        /**
         * D3: when the client owns a voided contract newer than the document being linked,
         * the client has no live contract; the document may still be claimed, but it must not
         * take `client.eDocId`. Applies on both lock surfaces and on every caller of
         * `linkExistingClient` (assigned repair, existing-only link, general link).
         */
        describe.each([
            ["plain path", false],
            ["lock-surface path", true],
        ])("D3: a newer voided contract of the same client blocks the pointer, %s", (_label, lockSurface) => {
            const expectedBlockerQuery = {
                where: {
                    clientId: 21,
                    voidedAt: { not: null },
                    AND: [
                        { OR: [{ documentKind: "contract" }, { documentKind: null }] },
                        {
                            OR: [
                                { createdDate: { gt: new Date("2026-07-20T00:00:00.000Z") } },
                                { createdDate: new Date("2026-07-20T00:00:00.000Z"), id: { gt: 11 } },
                            ],
                        },
                    ],
                },
                select: { id: true },
            };
            const existingOnly = {
                linkExistingOnly: true,
                existingClientId: 21,
                existingClientBranchId: "branch-1",
            };

            it("claims an unassigned document for the existing client but writes no pointer (existing-only)", async () => {
                const arranged = setup(completedUnassigned());
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.eformsign_doc.findFirst.mockResolvedValue({ id: 90 });

                await expect(arranged.usecase.execute("doc-1", existingOnly)).resolves.toBe("linked");

                expect(arranged.transaction.eformsign_doc.findFirst).toHaveBeenCalledTimes(1);
                expect(arranged.transaction.eformsign_doc.findFirst).toHaveBeenCalledWith(expectedBlockerQuery);
                expect(arranged.transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: expect.objectContaining({ id: 11 }),
                    data: expect.objectContaining({ clientId: 21, branchId: "branch-1" }),
                }));
                expect(arranged.transaction.client.updateMany).not.toHaveBeenCalled();
            });

            it("claims an unassigned document for the existing client but writes no pointer (general path)", async () => {
                const arranged = setup(completedUnassigned());
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.eformsign_doc.findFirst.mockResolvedValue({ id: 90 });

                await expect(arranged.usecase.execute("doc-1")).resolves.toBe("linked");

                expect(arranged.transaction.eformsign_doc.findFirst).toHaveBeenCalledWith(expectedBlockerQuery);
                expect(arranged.transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: expect.objectContaining({ id: 11 }),
                }));
                expect(arranged.transaction.client.updateMany).not.toHaveBeenCalled();
            });

            it("repairs ownership of an assigned document without writing the pointer", async () => {
                const arranged = setup(assignedDocument());
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.eformsign_doc.findFirst.mockResolvedValue({ id: 90 });

                await expect(arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                    .resolves.toBe("linked");

                expect(arranged.transaction.eformsign_doc.findFirst).toHaveBeenCalledWith(expectedBlockerQuery);
                expect(arranged.transaction.client.updateMany).not.toHaveBeenCalled();
                expect(arranged.serviceRecordLifecycle.ensureForClient).toHaveBeenCalledTimes(1);
            });

            it("links a document newer than the voided one and lets it take the pointer", async () => {
                const arranged = setup(completedUnassigned());
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.eformsign_doc.findFirst.mockResolvedValue(null);

                await expect(arranged.usecase.execute("doc-1", existingOnly)).resolves.toBe("linked");

                expect(arranged.transaction.eformsign_doc.findFirst).toHaveBeenCalledWith(expectedBlockerQuery);
                expect(arranged.transaction.client.updateMany).toHaveBeenCalledWith({
                    where: { id: 21, branchId: "branch-1", eDocId: null },
                    data: { eDocId: "doc-1" },
                });
            });

            it("does not filter the blocker by status or purge flag (a voided row mirrored as deleted keeps blocking)", async () => {
                const arranged = setup(completedUnassigned());
                if (lockSurface) withLockSurface(arranged.transaction);

                await arranged.usecase.execute("doc-1", existingOnly);

                const [query] = arranged.transaction.eformsign_doc.findFirst.mock.calls[0]!;
                expect(query.where).not.toHaveProperty("statusType");
                expect(query.where).not.toHaveProperty("permanentPurgeRequestedAt");
                expect(query.where.clientId).toBe(21);
            });
        });

        it("does not let a revision candidate created before the voided contract replace the pointer (plain path)", async () => {
            const document = assignedDocument({ revisionId: "rev-1" });
            const arranged = setup(document);
            arranged.transaction.client.findUnique.mockResolvedValue({
                id: 21, branchId: "branch-1", eDocId: "doc-old",
            });
            arranged.transaction.eformsign_doc.findUnique.mockImplementation(({ where }) =>
                Promise.resolve(
                    where.documentId === "doc-1"
                        ? document
                        : where.documentId === "doc-old"
                            ? {
                                createdDate: new Date("2026-07-25T00:00:00.000Z"),
                                revisionId: "rev-0",
                                serviceRecordCaseId: null,
                                branchId: "branch-1",
                                clientId: 21,
                            }
                            : null,
                ));

            // Control: no newer voided contract, the revision supersedes the older pointer.
            await arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration());
            expect(arranged.transaction.client.updateMany).toHaveBeenCalledWith({
                where: { id: 21, branchId: "branch-1", eDocId: "doc-old" },
                data: { eDocId: "doc-1" },
            });

            arranged.transaction.client.updateMany.mockClear();
            arranged.transaction.eformsign_doc.findFirst.mockResolvedValue({ id: 90 });
            await arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration());
            expect(arranged.transaction.eformsign_doc.findFirst).toHaveBeenCalledTimes(2);
            expect(arranged.transaction.client.updateMany).not.toHaveBeenCalled();
        });

        /**
         * Provider-bearing auto-registration on the complete lock surface: the
         * client, the schedule and the lifecycle write all happen inside the
         * transaction before the locked re-read of the document row. The
         * `$transaction` double records the promise of the callback handed to
         * it, so the rollback is observed as a rejection instead of being
         * inferred from later writes that never happened.
         */
        const arrangeProviderAutoRegistration = (voidUnderLock: boolean) => {
            const live = completedUnassigned({ detailPayload: contractDetailWithProviders() });
            const arranged = setup(live);
            withLockSurface(arranged.transaction);
            arranged.transaction.client.findMany.mockResolvedValue([]);
            arranged.transaction.employee.findMany.mockResolvedValue([
                { id: 55, name: "박관리사", phone: "010-5555-1111" },
                { id: 56, name: "최관리사", phone: "01055552222" },
            ]);
            // The created schedule is visible to the locked schedule read, as it
            // would be inside the real transaction.
            let createdScheduleId: number | null = null;
            const tx = arranged.transaction as typeof arranged.transaction & {
                employee_schedule: { findMany: jest.Mock };
            };
            tx.employee_schedule.create.mockImplementation(async () => {
                createdScheduleId = 91;
                return { id: 91 };
            });
            tx.employee_schedule.findMany.mockImplementation(async () => (
                createdScheduleId === null
                    ? []
                    : [{ id: createdScheduleId, primaryEmployeeId: 55, secondaryEmployeeId: 56 }]
            ));
            arranged.transaction.client.findUnique.mockImplementation(
                async ({ where }: { where: { id: number } }) => ({
                    id: where.id, branchId: "branch-1", eDocId: "doc-1",
                }),
            );
            if (voidUnderLock) {
                // First in-transaction read (before the client is created) is live; the
                // re-read under the document lock sees the void.
                arranged.transaction.eformsign_doc.findUnique
                    .mockResolvedValueOnce(live)
                    .mockResolvedValue({ ...live, voidedAt });
            }
            // A transaction COMMITS when its callback resolves and ROLLS BACK when it rejects.
            const callbacks: Promise<unknown>[] = [];
            arranged.prisma.$transaction.mockImplementation((
                work: (candidate: typeof arranged.transaction) => Promise<unknown>,
            ) => {
                const result = work(arranged.transaction);
                callbacks.push(result);
                return result;
            });
            return { ...arranged, callbacks };
        };

        it("rolls the auto-registered client, schedule and lifecycle back when the row is voided under the document lock", async () => {
            const arranged = arrangeProviderAutoRegistration(true);

            await expect(arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                .resolves.toBe("skipped");

            // The transaction callback itself REJECTED, so the database rolls back
            // everything it wrote; resolving "skipped" from inside it would commit
            // the temporary client, schedule and lifecycle rows.
            expect(arranged.callbacks).toHaveLength(1);
            await expect(arranged.callbacks[0]).rejects.toMatchObject({ name: "VoidedDocumentRollback" });

            // Written inside the rolled-back transaction, before the locked re-read saw the void.
            expect(arranged.transaction.client.create).toHaveBeenCalledTimes(1);
            expect(arranged.transaction.employee_schedule.create).toHaveBeenCalledTimes(1);
            expect(arranged.serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(
                31, arranged.transaction, expect.anything(),
            );
            // Nothing after the re-read: no claim, no automation intents, no notice.
            expect(arranged.transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(arranged.transaction.message_trigger_job.upsert).not.toHaveBeenCalled();
            expect(arranged.notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        });

        it("commits the same client, schedule and lifecycle writes for a live document (control)", async () => {
            const arranged = arrangeProviderAutoRegistration(false);

            await expect(arranged.usecase.execute("doc-1", undefined, expectedMirrorGeneration()))
                .resolves.toBe("created");

            // The first transaction is the registration itself (a later one belongs to
            // the post-create automation follow-up).
            await expect(arranged.callbacks[0]).resolves.toMatchObject({
                status: "created",
                createdClientId: 31,
                createdBranchId: "branch-1",
                createdScheduleId: 91,
            });
            expect(arranged.transaction.client.create).toHaveBeenCalledTimes(1);
            expect(arranged.transaction.employee_schedule.create).toHaveBeenCalledTimes(1);
            expect(arranged.serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(
                31, arranged.transaction, expect.anything(),
            );
            expect(arranged.transaction.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
        });
    });

    it("never links service-record documents as customer contracts", async () => {
        const { prisma, usecase } = setup();
        prisma.eformsign_doc.findUnique.mockResolvedValue(
            mirroredDocument({ documentKind: "service_record_snapshot" }),
        );

        await expect(usecase.execute("doc-1")).resolves.toBe("skipped");
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe("계약-05: an existing client is linked only to a document in an allowed status", () => {
        const identityMatchingDocument = (overrides: Record<string, unknown> = {}) =>
            mirroredDocument({
                branchId: "branch-1",
                customerPhone: "01012345678",
                detailPayload: contractDetail(),
                ...overrides,
            });

        /** The complete service-record lock surface, so the locked path runs. */
        const withLockSurface = (transaction: ReturnType<typeof setup>["transaction"]) => {
            const tx = transaction as typeof transaction & {
                employee_schedule: typeof transaction.employee_schedule & { findMany: jest.Mock };
                service_record_case: { findUnique: jest.Mock };
            };
            tx.employee_schedule.findMany = jest.fn().mockResolvedValue([]);
            tx.service_record_case = { findUnique: jest.fn().mockResolvedValue(null) };
        };

        const expectNothingWritten = (
            { transaction, serviceRecordLifecycle }: Pick<ReturnType<typeof setup>, "transaction" | "serviceRecordLifecycle">,
        ) => {
            expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
            expect(transaction.client.updateMany).not.toHaveBeenCalled();
            expect(transaction.client.create).not.toHaveBeenCalled();
            expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
        };

        describe.each([
            ["plain path", false],
            ["lock-surface path", true],
        ])("%s", (_label, lockSurface) => {
            it.each(["080", "001", "011", "042"])(
                "returns not_completed and writes nothing for a matching identity in status %s",
                async (statusType) => {
                    const arranged = setup(identityMatchingDocument({ statusType }));
                    if (lockSurface) withLockSurface(arranged.transaction);

                    await expect(arranged.usecase.execute("doc-1")).resolves.toBe("not_completed");

                    expectNothingWritten(arranged);
                },
            );

            it("still reports needs_confirmation for an identity mismatch in a non-linkable status", async () => {
                const arranged = setup(identityMatchingDocument({ statusType: "080" }));
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.client.findMany.mockResolvedValue([{
                    id: 21, branchId: "branch-1", phone: "010-1234-5678", eDocId: null,
                    name: "다른고객", birthday: "1992-03-04",
                }]);

                await expect(arranged.usecase.execute("doc-1")).resolves.toBe("needs_confirmation");

                expectNothingWritten(arranged);
            });

            it.each(["060", "040", "045", "071"])(
                "links a matching identity in status %s",
                async (statusType) => {
                    const arranged = setup(identityMatchingDocument({ statusType }));
                    if (lockSurface) withLockSurface(arranged.transaction);

                    await expect(arranged.usecase.execute("doc-1")).resolves.toBe("linked");

                    expect(arranged.transaction.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
                    expect(arranged.transaction.client.updateMany).toHaveBeenCalledWith({
                        where: { id: 21, branchId: "branch-1", eDocId: null },
                        data: { eDocId: "doc-1" },
                    });
                },
            );

            it("returns already_linked for a document already linked to the client in status 080", async () => {
                const arranged = setup(identityMatchingDocument({ statusType: "080", clientId: 21 }));
                if (lockSurface) withLockSurface(arranged.transaction);
                arranged.transaction.client.findUnique.mockResolvedValue({
                    id: 21, branchId: "branch-1", eDocId: "doc-1",
                });

                await expect(arranged.usecase.execute("doc-1")).resolves.toBe("already_linked");
            });
        });

        it("writes nothing when the status is not linkable in the re-read under the lock", async () => {
            const arranged = setup(identityMatchingDocument({ statusType: "060" }));
            withLockSurface(arranged.transaction);
            const unlocked = arranged.document;
            // First in-transaction read is the unlocked one (060); the `current` re-read
            // under the lock sees the status moved to 080.
            arranged.transaction.eformsign_doc.findUnique
                .mockResolvedValueOnce(unlocked)
                .mockResolvedValue({ ...unlocked, statusType: "080" });

            await expect(arranged.usecase.execute("doc-1")).resolves.toBe("not_completed");

            expectNothingWritten(arranged);
        });
    });
});
