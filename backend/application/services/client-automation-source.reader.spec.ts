import { createHash } from "node:crypto";
import { ClientAutomationSourceReader } from "./client-automation-source.reader";
import {
    DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL,
    buildServiceRecordLinkPayload,
    describeServiceRecordLinkEffect,
    type ServiceRecordLinkCaseSource,
    type ServiceRecordLinkScheduleSource,
    type ServiceRecordLinkTokenSource,
} from "./service-record-link-automation-effect-recipe";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import { agentAutomationScheduleIdentity } from "application/agent/agent-automation-consent";
import { getServiceRecordLinkScheduledFor } from "domain/constants/service-record-link-message";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";
import type { ClientMessageLogicalSubject } from "./client-message-effect-recipe";

const branchId = "76000000-0000-4000-8000-000000000001";
const clientId = 41;
const scheduleId = 17;
const now = new Date("2026-09-17T00:00:00Z");
const caseId = "76000000-0000-4000-8000-000000000009";
const incarnationId = "76000000-0000-4000-8000-000000000003";

function setup(links: Array<{ token: ServiceRecordLinkTokenSource | null }>, serviceRecordCase: object | null) {
    const prisma = {
        service_record_case: { findFirst: jest.fn().mockResolvedValue(serviceRecordCase) },
        employee_schedule: {
            findMany: jest.fn().mockResolvedValue(links.map(({ token }) => ({
                id: scheduleId,
                incarnationId,
                branchId,
                clientId,
                startDate: new Date("2026-10-01T00:00:00Z"),
                endDate: new Date("2026-10-15T00:00:00Z"),
                replaced: false,
                terminatedAt: null,
                primaryEmployeeId: 71,
                client: { id: clientId, name: "합성 고객", branchId, createdAt: now, serviceStatus: "active" },
                primaryEmployee: { id: 71, name: "합성 관리사", phone: "01000000071", branchId, deletedAt: null },
                serviceRecordTokens: token ? [token] : [],
            }))),
        },
    };
    const sources = new ClientAutomationSourceReader(
        prisma as never,
        { findAll: jest.fn().mockResolvedValue([]) } as never,
        { findAllByBranch: jest.fn().mockResolvedValue([]) } as never,
        { getApprovedBranches: jest.fn().mockResolvedValue(new Map()) } as never,
    );
    return { sources, prisma };
}

function token(overrides: Partial<ServiceRecordLinkTokenSource> = {}): ServiceRecordLinkTokenSource {
    return {
        id: "76000000-0000-4000-8000-000000000005",
        branchId,
        scheduleId,
        employeeId: 71,
        serviceRecordCaseId: null,
        linkTokenHash: "efl_synthetic_token",
        expectedPhoneHash: createHash("sha256").update("01000000071").digest("hex"),
        expiresAt: new Date("2026-10-22T11:00:00Z"),
        active: true,
        revokedAt: null,
        lockedAt: null,
        failedAttempts: 0,
        createdAt: now,
        ...overrides,
    };
}

function serviceRecordCase(overrides: Partial<ServiceRecordLinkCaseSource> = {}): ServiceRecordLinkCaseSource {
    return {
        id: caseId,
        branchId,
        clientId,
        status: "active",
        startDate: null,
        endDate: null,
        requiredSessionCount: null,
        formVersion: 1,
        version: 1,
        finalizedAt: null,
        updatedAt: now,
        ...overrides,
    };
}

function describeWithReaderInputs(link: {
    schedule: ServiceRecordLinkScheduleSource;
    serviceRecordCase: ServiceRecordLinkCaseSource | null;
    token: ServiceRecordLinkTokenSource;
}) {
    // Both the preview planner and the dispatch authority feed the same
    // describeServiceRecordLinkEffect with the row they each read; this helper
    // reproduces those identical inputs from one reader result.
    return describeServiceRecordLinkEffect({
        branchId,
        subject: { kind: "client", clientId, clientIdentity: "a".repeat(64) } as ClientMessageLogicalSubject,
        rule: MessageTriggerRuleEntity.reconstitute(
            SERVICE_RECORD_LINK_RULE_ID, null, "제공기록지 링크", true,
            MessageTriggerEventType.SERVICE_START, MessageTriggerOffsetType.SAME_DAY, 0,
            MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            now, now, true, false, "15:00",
        ),
        schedule: link.schedule,
        serviceRecordCase: link.serviceRecordCase,
        token: link.token,
        scheduleIdentity: agentAutomationScheduleIdentity(incarnationId),
        serviceRecordUrl: `${DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL}/service-record/${link.token.linkTokenHash}`,
        sourcePayload: buildServiceRecordLinkPayload({
            clientId,
            clientName: "합성 고객",
            employeeId: 71,
            employeeName: "합성 관리사",
            recipientPhone: "01000000071",
            buttonUrl: `${DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL}/service-record/${link.token.linkTokenHash}`,
            serviceRecordUrl: `${DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL}/service-record/${link.token.linkTokenHash}`,
            serviceStartDate: "2026-10-01",
            serviceEndDate: "2026-10-15",
        }),
        scheduledFor: getServiceRecordLinkScheduledFor(new Date("2026-10-01T00:00:00Z")),
        dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary`,
        snapshot: {
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            receiver: "01000000071",
            maskedReceiver: "010****0071",
            recipientName: "합성 관리사",
            message: "합성 제공기록지 링크",
            title: "제공기록지",
            requestedDeliveryType: "AUTO",
            deliveryType: "SMS",
            estimatedCost: "0",
            templateVersion: "1",
            templateHash: "b".repeat(64),
            configVersion: "1",
            configHash: "c".repeat(64),
            snapshotHash: "d".repeat(64),
        } as SmsTriggerDeliverySnapshot,
        change: "create",
        policy: {
            dispatchEnabled: true,
            senderApproved: true,
            senderIdentityDigest: "e".repeat(64),
            senderApprovedAt: now.toISOString(),
            pastTriggerEnabled: true,
            pastTriggerConfig: { sendIntervalMinutes: 1, ruleOrder: [] },
        },
        now,
    });
}

function singleLink(links: Awaited<ReturnType<ClientAutomationSourceReader["readClientAutomationServiceRecordLinks"]>>) {
    const [link] = links;
    if (!link || links.length !== 1) throw new Error("Expected exactly one service-record link row");
    return link;
}

describe("client automation source reader service-record links", () => {
    it("reads the client-owned case by branch+client instead of the token relation", async () => {
        const row = serviceRecordCase();
        const legacyToken = token();
        const { sources, prisma } = setup([{ token: legacyToken }], row);

        const links = await sources.readClientAutomationServiceRecordLinks(branchId, clientId);

        expect(prisma.service_record_case.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { branchId, clientId } }),
        );
        const link = singleLink(links);
        expect(link.token?.serviceRecordCaseId).toBeNull();
        // The legacy token's stale null case id no longer hides the real case:
        // preview evaluates the same case the dispatch authority read.
        expect(link.serviceRecordCase).toEqual(row);
    });

    it("keeps serviceRecordCase null when the client owns no case", async () => {
        const { sources } = setup([{ token: token() }], null);

        const links = await sources.readClientAutomationServiceRecordLinks(branchId, clientId);

        expect(singleLink(links).serviceRecordCase).toBeNull();
    });

    it("does not accept a token/case pair whose case ids disagree (legacy token after case creation)", async () => {
        // Legacy token: serviceRecordCaseId stayed null after a case exists.
        const { sources } = setup([{ token: token() }], serviceRecordCase());
        const link = singleLink(await sources.readClientAutomationServiceRecordLinks(branchId, clientId));
        const legacyToken = link.token;
        if (!legacyToken) throw new Error("Expected a token on the legacy link row");

        // The relation-trusted view (the pre-fix source) accepted the false pair…
        const relationView = describeWithReaderInputs({ ...link, token: legacyToken, serviceRecordCase: null });
        expect(relationView).not.toBeNull();

        // …but the independently-read source — the source the dispatch
        // authority already used — rejects it, and both paths therefore agree.
        expect(describeWithReaderInputs({ ...link, token: legacyToken })).toBeNull();
    });

    it("still grants a positive effect when the reviewed token and case pair is genuine", async () => {
        const row = serviceRecordCase();
        const { sources } = setup(
            [{ token: token({ serviceRecordCaseId: caseId }) }],
            row,
        );
        const link = singleLink(await sources.readClientAutomationServiceRecordLinks(branchId, clientId));
        const activeToken = link.token;
        if (!activeToken) throw new Error("Expected a token on the genuine link row");

        expect(link.serviceRecordCase).toEqual(row);
        const effect = describeWithReaderInputs({ ...link, token: activeToken });
        expect(effect).toMatchObject({ kind: "service-record-link", scheduleId, change: "create" });
    });

    it("leaves a token-less schedule with case sources of null", async () => {
        const row = serviceRecordCase();
        const { sources } = setup([{ token: null }], row);

        const links = await sources.readClientAutomationServiceRecordLinks(branchId, clientId);

        const link = singleLink(links);
        expect(link.token).toBeNull();
        expect(link.serviceRecordCase).toBeNull();
    });
});
