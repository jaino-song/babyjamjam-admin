import { BadRequestException } from "@nestjs/common";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SMS_DELIVERY_SNAPSHOT_VARIABLE } from "domain/constants/sms-delivery-snapshot";
import { protectedReceiptOriginalSql } from "infrastructure/database/repositories/receipt-job-recovery.repository";
import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { AUTOMATION_CONSENT_CANCEL_REASON } from "domain/constants/message-automation-policy";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import { manualTemplateVariables } from "infrastructure/database/repositories/message-occurrence-ledger";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient, type message_trigger_job } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { AligoDefaultSenderPolicyService } from "application/services/aligo-default-sender-policy.service";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import { ClientAutomationSourceReader } from "application/services/client-automation-source.reader";
import { ClientService } from "application/services/client.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { MessageQuietHoursService } from "application/services/message-quiet-hours.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { buildMessageRecipeDedupeKey } from "application/services/message-trigger-recipes";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { RECEIPT_LINK_SKIP_MESSAGES, ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { SmsTriggerPayloadEnricherRegistry } from "application/services/sms-trigger-payload-enricher.registry";
import { SystemSettingService } from "application/services/system-setting.service";
import { FindClientByIdUsecase } from "application/usecases/client/find-client-by-id.usecase";
import { DeleteClientUsecase } from "application/usecases/client/delete-client.usecase";
import { UpdateClientUsecase } from "application/usecases/client/update-client.usecase";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import { MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import { SYSTEM_TEMPLATE_REGISTRY, type SystemTemplateKey } from "domain/constants/system-template-registry";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { CanceledAutomationRetryRepository } from "infrastructure/database/repositories/canceled-automation-retry.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbHolidayCalendarRepository } from "infrastructure/database/repositories/sb.holiday-calendar.repository";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { mirrorDetail } from "../contracts/contracts-fixture";
import {
    createBranch, createClient, createEformsignDoc, createEmployee, createEmployeeSchedule,
    createMessageLog, createMessageTriggerJob, createMessageTriggerRule, createUser,
} from "../helpers/factories";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";

const beforeDue = new Date("2026-11-24T00:00:00.000Z");
const originalDue = new Date("2026-11-24T01:00:00.000Z");
const nineDaysLater = new Date("2026-12-03T01:00:00.000Z");
const pdf = Buffer.from("%PDF-1.7 synthetic private fixture");
const pdfDigest = createHash("sha256").update(pdf).digest("hex");
const receiptReasons = ["live_unsigned_contract", "missing_birthday", "missing_current_contract", "current_contract_pdf_pending"] as const;

describeReal("automatic receipt eligibility recovery on PostgreSQL", () => {
    let db: IntegrityPrisma;
    let independent: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    const sendSms = jest.fn(async (request: { receiver: string; message?: string }) => ({
        request: { ...request, msgType: "LMS", testModeYn: "N" },
        response: { result_code: 1, success_cnt: 1, error_cnt: 0, message: "accepted", msg_id: 42 },
    }));

    beforeAll(async () => {
        db = await createIntegrityPrisma();
        independent = await createIntegrityPrisma();
    });

    beforeEach(async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "hrtime", "performance"] });
        jest.setSystemTime(beforeDue);
        sendSms.mockClear();
        tracker = new RowTracker();
        ({ id: branchId } = await createBranch(db.raw, tracker, { smsSenderApprovalStatus: "approved" }));
    });

    afterEach(async () => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        await db.raw.message_occurrence_manual_attempt.deleteMany({ where: { branchId } });
        await db.raw.message_occurrence_claim.deleteMany({ where: { branchId } });
        await db.raw.message_log.deleteMany({ where: { branchId } });
        await db.raw.receipt_link_token.deleteMany({ where: { branchId } });
        await db.raw.message_trigger_job.deleteMany({ where: { branchId, originalJobId: { not: null } } });
        await db.raw.message_trigger_job.deleteMany({ where: { branchId } });
        await db.raw.message_trigger_rule_branch_override.deleteMany({ where: { branchId } });
        await db.raw.system_setting.deleteMany({ where: { key: { startsWith: `branch:${branchId}:` } } });
        await tracker.cleanup(db.raw);
    });

    afterAll(async () => {
        await closeIntegrityPrisma(independent);
        await closeIntegrityPrisma(db);
    });

    function worker(handle: IntegrityPrisma) {
        const database = handle.service;
        const lock = new MessageAutomationBranchLockService(database);
        const activation = new MessageAutomationActivationService(database, lock, {} as never);
        const approval = new MessageSenderApprovalService(database);
        const retry = new CanceledAutomationRetrySettingsService(new CanceledAutomationRetryRepository(database), lock, activation);
        const logs = new SbMessageLogRepository(database);
        const jobs = new SbMessageTriggerJobRepository(database);
        const rules = new SbMessageTriggerRuleRepository(database);
        const overrides = new SbMessageTriggerRuleBranchOverrideRepository(database);
        const settingRepo = new SbSystemSettingRepository(database);
        const settings = new SystemSettingService(new GetSettingUsecase(settingRepo), new UpdateSettingUsecase(settingRepo),
            undefined, activation, rules, jobs, logs, lock);
        const templates = { getByKeyForBranch: async (_branchId: string, key: SystemTemplateKey) => ({
            id: key, content: SYSTEM_TEMPLATE_REGISTRY[key].defaultContent, updatedAt: new Date(0),
        }) };
        const config = new ConfigService({ RECEIPT_LINK_HASH_SALT: "synthetic-private-db-test",
            MOBILE_RECEIPT_BASE_URL: "https://example.test", CLIENT_TOMBSTONE_DELETE_ENABLED: "true" });
        const clientRepo = new SbClientRepository(database, config);
        const docRepo = new SbEformsignDocRepository(database);
        const mirror = new SbEformsignDocumentMirrorRepository(database);
        const tokenRepo = new SbReceiptLinkTokenRepository(database);
        const tokens = new ReceiptLinkTokenService(tokenRepo, config);
        const storage = { upload: jest.fn(async () => {}), createSignedUrl: jest.fn(async () => "https://example.test/file") };
        const vendor = { syncDocument: jest.fn(async (): Promise<void> => { throw new Error("synthetic vendor read failure"); }) };
        const issue = new ReceiptLinkIssueService(clientRepo, docRepo, mirror, vendor as never, config,
            { renderPageToPng: async () => Buffer.from("synthetic PNG") } as never, tokens, storage as never);
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enricher = new ReceiptLinkDeliveryEnricher(registry, issue, tokens, storage as never, tokenRepo);
        enricher.onModuleInit();
        const sources = new ClientAutomationSourceReader(database, rules, overrides, approval, settings, activation);
        const sender = new AligoDefaultSenderPolicyService({ getDefaultSenderPolicy: () => ({ availability: "unavailable" }) } as never);
        const authority = new AgentAutomationJobAuthorityService(new AgentAutomationAuthorityService(new AgentAutomationRecordStoreService(lock)),
            sources, sender);
        const gate = new AgentAutomationDeliveryGateService(database, lock, authority);
        const acceptance = new SmsProviderAcceptanceService(logs);
        const quiet = new MessageQuietHoursService(settings, logs, lock);
        const safeguard = new SmsAutomationSafeguardService(database, activation);
        const delivery = new SmsTriggerDeliveryService({ sendSms } as never, templates as never, logs,
            acceptance, registry, gate, rules, settings, undefined, quiet, jobs);
        const trigger = new MessageTriggerService(database, new MessageTriggerDeliveryService(delivery), approval, rules, jobs, logs,
            templates as never, new MessageTemplateAutomationLockService(database), settings, overrides, activation, lock, sources, gate,
            clientRepo, safeguard, undefined, undefined, delivery, retry);
        const transport = new SmsRetryService(logs, { sendSms } as never, approval, acceptance, activation,
            authority, delivery, jobs, safeguard, settings, quiet, sender, trigger);
        const calendar = { forBranch: async () => KR_BUILTIN_CALENDAR } as never;
        const intents = new MessageAutomationIntentService(database, trigger, {} as never, {} as never);
        const clients = new ClientService({} as never, new FindClientByIdUsecase(clientRepo), {} as never, {} as never,
            new UpdateClientUsecase(clientRepo, calendar), new DeleteClientUsecase(clientRepo), database, clientRepo, settings,
            { invalidate: async () => {} } as never, intents, calendar, trigger,
            undefined, undefined, config, undefined, undefined, undefined, lock);
        return { retry, trigger, clients, delivery, issue, vendor, mirror, acceptance, lock, docRepo, transport, settings, intents, jobs, storage };
    }

    async function fixture(birthday: string | null = "19940510") {
        const client = await createClient(db.raw, tracker, { branchId, voucherClient: true, birthday, smsAutomationEnabled: true,
            startDate: new Date("2026-11-14"), endDate: new Date("2026-11-24") });
        const rule = await createMessageTriggerRule(db.raw, tracker, { branchId, eventType: "SERVICE_END", offsetType: "SAME_DAY",
            templateKey: "SERVICE_END_NOTICE", sendTime: "10:00", isActive: true });
        return { ...worker(db), client, rule };
    }

    async function makeContract(clientId: number) {
        return createEformsignDoc(db.raw, tracker, { branchId, clientId, documentKind: "contract", statusType: "060" });
    }

    async function syncGeneration(document: { id: number; documentId: string }, step: "unsigned" | "signed", ready: boolean,
        syncStatus = ready ? "ready" : "syncing") {
        const at = new Date();
        const status = step === "signed" ? "070" : "060";
        const detail = mirrorDetail({ documentId: document.documentId, statusType: status, updatedDate: at,
            stepType: step === "signed" ? "06" : "05", stepName: step === "signed" ? "제공기관 확인" : "고객 서명" });
        await db.raw.eformsign_doc.update({ where: { id: document.id }, data: {
            statusType: status, detailPayload: detail as unknown as Prisma.InputJsonValue, detailSourceUpdatedDate: at,
            detailSyncedAt: at, syncStatus, syncError: syncStatus === "failed" ? "fixture failure" : null,
        } });
        if (ready) {
            const mirror = new SbEformsignDocumentMirrorRepository(db.service);
            expect(await mirror.saveFile({ documentId: document.documentId, fileType: "document",
                contentType: "application/pdf", contentDisposition: null, byteSize: pdf.length, sha256: pdfDigest,
                content: pdf, sourceUpdatedDate: at, syncedAt: at })).toBe(true);
        }
    }

    const advance = (at: Date, minutes: number) => jest.setSystemTime(new Date(at.getTime() + minutes * 60_000));
    const receiptKey = (ruleId: string, clientId: number, due: Date) =>
        buildMessageRecipeDedupeKey(ruleId, `client:${clientId}`, due, MessageTriggerRecipientType.CLIENT);

    async function getOriginal(ruleId: string): Promise<message_trigger_job> {
        return db.raw.message_trigger_job.findFirstOrThrow({ where: { branchId, ruleId, originalJobId: null } });
    }

    async function outcomes(original: message_trigger_job, expected: { children: number; accepted: number; calls: number }) {
        const rows = await db.raw.message_trigger_job.findMany({ where: { branchId, ruleId: original.ruleId } });
        const retained = rows.find(row => row.id === original.id);
        expect(retained).toMatchObject({ status: "canceled", canceledAt: original.canceledAt, scheduledFor: original.scheduledFor });
        const children = rows.filter(row => row.originalJobId === original.id);
        expect(children).toHaveLength(expected.children);
        expect(rows).toHaveLength(expected.children + 1);
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, state: "accepted", slot: { not: null } } }))
            .toBe(expected.accepted);
        expect(sendSms).toHaveBeenCalledTimes(expected.calls);
        return children[0];
    }

    async function firstAttempt(f: Awaited<ReturnType<typeof fixture>>, at = originalDue) {
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        expect(await getOriginal(f.rule.id)).toMatchObject({ status: "pending", scheduledFor: originalDue });
        jest.setSystemTime(at);
        await f.trigger.dispatchDueJobs();
        return getOriginal(f.rule.id);
    }

    async function eligibleUnsignedReceipt(f: Awaited<ReturnType<typeof fixture>>) {
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "unsigned", false);
        await f.retry.update(branchId, f.rule.id, true);
        const original = await firstAttempt(f);
        expect(original).toMatchObject({ recoveryState: "eligible", recoveryReason: "live_unsigned_contract" });
        return { document, original };
    }

    async function expectReceiptRecoveryAt(f: Awaited<ReturnType<typeof fixture>>,
        document: Awaited<ReturnType<typeof makeContract>>, original: message_trigger_job, due: Date) {
        await syncGeneration(document, "signed", true);
        await f.trigger.wakeReceiptRecoveryForDocument(branchId, document.documentId);
        const child = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original.id } });
        expect(child).toMatchObject({ scheduledFor: due, recoveryEpoch: original.recoveryEpoch });
        if (new Date() < due) {
            await f.trigger.dispatchDueJobs();
            await outcomes(original, { children: 1, accepted: 0, calls: 0 });
        }
        jest.setSystemTime(due);
        await f.trigger.dispatchDueJobs();
        expect((await outcomes(original, { children: 1, accepted: 1, calls: 1 }))?.id).toBe(child.id);
    }

    const noRecovery = { canceledAt: null, firstBlockedAt: null, recoveryReason: null,
        recoveryEpoch: null, recoveryState: null, nextCheckAt: null };
    const noDelivery = { children: 0, accepted: 0, calls: 0 };
    const terminal = { status: "canceled", attempts: 0, canceledAt: originalDue, firstBlockedAt: originalDue,
        recoveryReason: "receipt_recovery_not_proven", recoveryState: "ineligible_terminal", recoveryEpoch: null, nextCheckAt: null };
    const skip = (reason: keyof typeof RECEIPT_LINK_SKIP_MESSAGES) => `메시지 발송 건너뜀: ${RECEIPT_LINK_SKIP_MESSAGES[reason]}`;
    const paired = <T>(cases: readonly T[]) => [false, true].flatMap(enabled => cases.map(testCase => [enabled, testCase] as const));

    it.each(paired([...receiptReasons, "pdf disappears at boundary"] as const))(
        "toggle %s captures %s and only continuous ON recovers after committed evidence", async (enabled, scenario) => {
        const atBoundary = scenario === "pdf disappears at boundary";
        const reason = atBoundary ? "current_contract_pdf_pending" : scenario;
        const f = await fixture(reason === "missing_birthday" ? null : undefined);
        let document = reason === "missing_current_contract" ? null : await makeContract(f.client.id);
        if (document) await syncGeneration(document, reason === "live_unsigned_contract" ? "unsigned" : "signed",
            reason === "missing_birthday" || atBoundary, atBoundary ? "syncing" : undefined);
        if (atBoundary && document) {
            const { id: eformsignDocId, documentId } = document;
            const actualRead = f.mirror.findFile.bind(f.mirror);
            jest.spyOn(f.mirror, "findFile").mockImplementationOnce(actualRead).mockImplementationOnce(async () => {
                await independent.raw.eformsign_doc_file.deleteMany({ where: { eformsignDocId } });
                return actualRead(documentId, "document");
            });
        }
        const setting = await f.retry.update(branchId, f.rule.id, enabled);
        const original = await firstAttempt(f);
        const skipCode = {
            live_unsigned_contract: "contract_not_signed", missing_birthday: "missing_birthday",
            missing_current_contract: "no_contract_document", current_contract_pdf_pending: "pdf_unavailable",
        } as const;
        expect(original).toMatchObject({
            status: "canceled", attempts: 0, recoveryReason: reason, cancelReason: skip(skipCode[reason]),
            firstBlockedAt: originalDue, canceledAt: originalDue, recoveryState: enabled ? "eligible" : "ineligible_terminal",
            recoveryEpoch: enabled ? new Date(setting.enabledAt!) : null,
            nextCheckAt: enabled ? new Date(originalDue.getTime() + 60_000) : null,
        });
        await outcomes(original, noDelivery);
        if (!enabled) await f.retry.update(branchId, f.rule.id, true);
        jest.setSystemTime(nineDaysLater);
        if (reason === "missing_birthday") {
            await f.clients.update(branchId, f.client.id, { birthday: "19940510" });
        } else {
            document ??= await makeContract(f.client.id);
            await syncGeneration(document, "signed", true);
        }
        const secondWorker = worker(independent);
        if (enabled && reason === "live_unsigned_contract") {
            const read = f.mirror.findFile.bind(f.mirror);
            let resume!: () => void;
            let haveLock!: () => void;
            let bothSelected!: () => void;
            const release = new Promise<void>(resolve => { resume = resolve; });
            const locked = new Promise<void>(resolve => { haveLock = resolve; });
            const selected = new Promise<void>(resolve => { bothSelected = resolve; });
            jest.spyOn(f.mirror, "findFile").mockImplementationOnce(async (...args) => {
                haveLock();
                await release;
                return read(...args);
            });
            const select = secondWorker.jobs.findReceiptRecoveryCandidates.bind(secondWorker.jobs);
            let competingReads = 0;
            jest.spyOn(secondWorker.jobs, "findReceiptRecoveryCandidates").mockImplementation(async (...args) => {
                const result = await select(...args);
                expect(result).toContainEqual({ id: original.id, branchId });
                if (++competingReads === 2) bothSelected();
                return result;
            });
            const sweeper = f.trigger.sweepReceiptRecovery();
            let competitors: Promise<unknown> | undefined;
            try {
                await Promise.race([locked, sweeper.then(() => { throw new Error("Sweep finished before admission barrier"); })]);
                competitors = Promise.all([
                    secondWorker.trigger.sweepReceiptRecovery(), secondWorker.trigger.wakeReceiptRecovery(branchId, f.client.id),
                ]);
                await Promise.race([selected, competitors.then(() => { throw new Error("Competitors finished before selecting the parent"); })]);
            } finally {
                resume();
                await Promise.all([sweeper, competitors]);
                jest.restoreAllMocks();
            }
        } else {
            await Promise.all([
                f.trigger.sweepReceiptRecovery(), secondWorker.trigger.sweepReceiptRecovery(),
                secondWorker.trigger.wakeReceiptRecovery(branchId, f.client.id),
            ]);
        }
        if (!enabled) {
            await Promise.all([f.trigger.dispatchDueJobs(), secondWorker.trigger.dispatchDueJobs()]);
            await outcomes(original, noDelivery);
            return;
        }
        const child = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original.id } });
        expect(child).toMatchObject({ scheduledFor: nineDaysLater, createdAt: nineDaysLater, recoveryEpoch: original.recoveryEpoch });
        await Promise.all([f.trigger.dispatchDueJobs(), secondWorker.trigger.dispatchDueJobs()]);
        await outcomes(original, { children: 1, accepted: 1, calls: 1 });
    });

    it.each(["off-at-failure", "changed-epoch", "legacy-text", "legacy-null"] as const)(
        "keeps %s history immutable through a real client edit", async scenario => {
            const f = await fixture();
            const document = await makeContract(f.client.id);
            await syncGeneration(document, "unsigned", false);
            if (scenario !== "off-at-failure") await f.retry.update(branchId, f.rule.id, true);
            const first = await firstAttempt(f);
            if (scenario === "changed-epoch") await f.retry.update(branchId, f.rule.id, false);
            if (scenario.startsWith("legacy")) await db.raw.message_trigger_job.update({ where: { id: first.id }, data: {
                recoveryReason: null, recoveryEpoch: null, firstBlockedAt: null, recoveryState: null, nextCheckAt: null,
                payload: first.payload as Prisma.InputJsonObject,
                cancelReason: scenario === "legacy-null" ? null : "이전 영수증 관련 기록",
            } });
            await f.retry.update(branchId, f.rule.id, true);
            const original = await getOriginal(f.rule.id);
            const unrelated = await createMessageTriggerRule(db.raw, tracker, { branchId, templateKey: "THANKS",
                eventType: "SERVICE_END", offsetType: "AFTER_DAYS", offsetDays: 1, sendTime: "10:00", isActive: true });
            advance(originalDue, 300);
            await syncGeneration(document, "signed", true);
            await f.clients.update(branchId, f.client.id, { name: "QA-수정" });
            await f.trigger.dispatchDueJobs();
            expect(await db.raw.message_trigger_job.count({ where: { branchId, ruleId: unrelated.id, status: "pending" } })).toBe(1);
            await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        },
    );

    it("keeps a signed-before-due normal trigger scheduled until due", async () => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "signed", true);
        await f.retry.update(branchId, f.rule.id, true);
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        await f.trigger.wakeReceiptRecoveryForDocument(branchId, document.documentId);
        await f.trigger.dispatchDueJobs();
        expect(sendSms).not.toHaveBeenCalled();
        jest.setSystemTime(originalDue);
        await f.trigger.dispatchDueJobs();
        expect(await getOriginal(f.rule.id)).toMatchObject({ status: "sent", recoveryReason: null });
        expect(sendSms).toHaveBeenCalledTimes(1);
    });

    it.each(["before first attempt", "after successor creation"])("makes sender denial %s terminal", async stage => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "unsigned", false);
        await f.retry.update(branchId, f.rule.id, true);
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        const deny = (status: string) => db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: status } });
        if (stage === "before first attempt") await deny("pending");
        jest.setSystemTime(originalDue);
        await f.trigger.dispatchDueJobs();
        const original = await getOriginal(f.rule.id);
        await syncGeneration(document, "signed", true);
        await f.trigger.wakeReceiptRecovery(branchId, f.client.id);
        const child = await db.raw.message_trigger_job.findUnique({ where: { originalJobId: original.id } });
        if (stage === "after successor creation") {
            expect(child).not.toBeNull();
            await deny("pending");
            advance(originalDue, 2);
            await f.trigger.dispatchDueJobs();
        }
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: child?.id ?? original.id } }))
            .toMatchObject({ status: "canceled", cancelReason: MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON });
        await deny("approved");
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, true);
        await f.trigger.dispatchDueJobs();
        await outcomes(original, { children: child ? 1 : 0, accepted: 0, calls: 0 });
    });

    async function admittedChild() {
        const f = await fixture();
        const { document, original } = await eligibleUnsignedReceipt(f);
        advance(originalDue, 300);
        await syncGeneration(document, "signed", true);
        await f.trigger.wakeReceiptRecovery(branchId, f.client.id);
        const child = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original.id } });
        return { f, document, original, child };
    }

    function pauseAfterPreparation(workerUnderTest: ReturnType<typeof worker>) {
        let markPrepared!: () => void;
        let resume!: () => void;
        const prepared = new Promise<void>(resolve => { markPrepared = resolve; });
        const paused = new Promise<void>(resolve => { resume = resolve; });
        const prepare = workerUnderTest.delivery.prepareJob.bind(workerUnderTest.delivery);
        jest.spyOn(workerUnderTest.delivery, "prepareJob").mockImplementationOnce(async job => {
            const result = await prepare(job);
            markPrepared();
            await paused;
            return result;
        });
        return { prepared, resume };
    }

    it.each([
        ["client", "pending"], ["client", "processing"], ["rule", "pending"], ["rule", "processing"],
    ] as const)("refreshes a %s edit on an admitted %s child in place", async (edit, state) => {
        const { f, original, child } = await admittedChild();
        const editor = worker(independent);
        const oldTime = child.scheduledFor;
        const newTime = edit === "client" ? new Date("2026-11-25T01:00:00.000Z") : new Date("2026-11-24T07:00:00.000Z");
        const pause = state === "processing" ? pauseAfterPreparation(f) : null;
        const inflight = pause && f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        try {
            if (pause) await pause.prepared;
            if (edit === "client") {
                await editor.clients.update(branchId, f.client.id, { endDate: "2026-11-25", allowBusinessDayMismatch: true });
                await editor.trigger.reconcileServiceRecordDateRules(branchId, f.client.id, { startDate: false, endDate: true, scheduleIds: [] });
            } else {
                await editor.trigger.updateRule(branchId, f.rule.id, { sendTime: "16:00" });
            }
            expect(await db.raw.message_trigger_job.findUnique({ where: { id: child.id } }))
                .toMatchObject({ originalJobId: original.id, status: "pending", scheduledFor: newTime, createdAt: child.createdAt, claimToken: null });
        } finally {
            pause?.resume();
            await inflight;
        }
        jest.setSystemTime(oldTime);
        await editor.trigger.dispatchDueJobs();
        await outcomes(original, { children: 1, accepted: 0, calls: 0 });
        jest.setSystemTime(newTime);
        await editor.trigger.dispatchDueJobs();
        expect((await outcomes(original, { children: 1, accepted: 1, calls: 1 }))?.id).toBe(child.id);
    });

    it("releases a prepared snapshot on a payload-only edit even if its due time is unchanged", async () => {
        const { f, original, child } = await admittedChild();
        const editor = worker(independent);
        const pause = pauseAfterPreparation(f);
        const inflight = f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        try {
            await pause.prepared;
            await editor.clients.update(branchId, f.client.id, { name: "QA-교체된 이름" });
        } finally {
            pause.resume();
            await inflight;
        }
        const refreshed = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: child.id } });
        expect(refreshed).toMatchObject({ scheduledFor: child.scheduledFor, status: "pending", claimToken: null,
            payload: { clientName: "QA-교체된 이름" } });
        await outcomes(original, { children: 1, accepted: 0, calls: 0 });
        await editor.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        await outcomes(original, { children: 1, accepted: 1, calls: 1 });
    });

    it.each(["pending", "processing"] as const)("uses the approved-target rule mutation fence for a %s child", async state => {
        const { f, original, child } = await admittedChild();
        const editor = worker(independent);
        const rule = await editor.trigger.getRule(branchId, f.rule.id);
        const version = editor.trigger["ruleTargetVersion"](rule);
        const snapshot = { ...rule, updatedAt: rule.updatedAt.toISOString(), createdAt: rule.createdAt.toISOString() };
        const pause = state === "processing" ? pauseAfterPreparation(f) : null;
        const inflight = pause && f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        try {
            if (pause) {
                await pause.prepared;
                expect(await independent.raw.message_trigger_job.findUnique({ where: { id: child.id } })).toMatchObject({
                    status: "processing", claimToken: expect.any(String), originalJobId: original.id,
                });
                expect(editor.trigger["ruleTargetVersion"](await editor.trigger.getRule(branchId, rule.id))).toBe(version);
            }
            const mutation = editor.trigger.updateRuleApprovedTarget(branchId, f.rule.id, { sendTime: "16:00" }, version, snapshot);
            if (pause) {
                const error = await mutation.catch((cause: unknown) => cause);
                expect(error).toBeInstanceOf(BadRequestException);
                expect((error as BadRequestException).getStatus()).toBe(400);
                expect((error as BadRequestException).getResponse()).toMatchObject({
                    code: "VALIDATION_FAILED", outcome: "NOT_APPLIED",
                    errors: [{ pointer: "/targetVersion", code: "INVALID_VALUE", location: "body",
                        detail: "Automation rule changed after approval" }],
                });
                const retainedRule = await editor.trigger.getRule(branchId, rule.id);
                expect(retainedRule.sendTime).toBe("10:00");
                expect(editor.trigger["ruleTargetVersion"](retainedRule)).toBe(version);
            } else {
                await mutation;
                expect(await db.raw.message_trigger_job.findUnique({ where: { id: child.id } })).toMatchObject({
                    originalJobId: original.id, status: "pending", scheduledFor: new Date("2026-11-24T07:00:00.000Z"),
                });
            }
        } finally {
            pause?.resume();
            await inflight;
        }
        if (!pause) {
            await editor.trigger.dispatchDueJobs();
            expect(sendSms).not.toHaveBeenCalled();
            jest.setSystemTime(new Date("2026-11-24T07:00:00.000Z"));
            await editor.trigger.dispatchDueJobs();
        }
        await outcomes(original, { children: 1, accepted: 1, calls: 1 });
    });

    it.each([
        ["user cancellation", "pending"], ["user cancellation", "processing"],
        ["client deletion", "pending"], ["client deletion", "processing"],
        ["epoch change", "pending"], ["epoch change", "processing"],
        ["sender denial", "pending"], ["sender denial", "processing"],
    ] as const)("keeps %s terminal for an admitted %s child", async (action, state) => {
        const { f, original, child } = await admittedChild();
        const editor = worker(independent);
        const pause = state === "processing" ? pauseAfterPreparation(f) : null;
        const inflight = pause && f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        try {
            if (pause) await pause.prepared;
            if (action === "user cancellation") await editor.trigger.cancelJobByUser(branchId, child.id);
            else if (action === "client deletion") await editor.clients.delete(branchId, f.client.id);
            else if (action === "sender denial") await independent.raw.branch.update({ where: { id: branchId },
                data: { smsSenderApprovalStatus: "pending" } });
            else {
                await editor.retry.update(branchId, f.rule.id, false);
                await editor.retry.update(branchId, f.rule.id, true);
            }
        } finally {
            pause?.resume();
            await inflight;
        }
        advance(child.scheduledFor, 2);
        await editor.trigger.wakeReceiptRecovery(branchId, f.client.id);
        await editor.trigger.dispatchDueJobs();
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: child.id } })).toMatchObject({ status: "canceled" });
        if (action === "sender denial") {
            await db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
            await editor.trigger.wakeReceiptRecovery(branchId, f.client.id);
            await editor.trigger.dispatchDueJobs();
        }
        await outcomes(original, { children: 1, accepted: 0, calls: 0 });
    });

    it.each([
        "missing mirror", "unknown status", "void", "revoke", "replacement", "purge",
        "wrong document tenant", "deleted client", "wrong client tenant",
    ] as const)(
        "makes %s terminal despite a later signed document", async condition => {
            const f = await fixture();
            const document = await makeContract(f.client.id);
            await syncGeneration(document, "unsigned", false);
            if (condition === "missing mirror") {
                await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { detailPayload: Prisma.DbNull } });
            } else if (condition === "unknown status") {
                await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { detailPayload: mirrorDetail({
                    documentId: document.documentId, statusType: "998", updatedDate: beforeDue,
                }) as unknown as Prisma.InputJsonObject } });
            } else if (condition === "wrong document tenant") {
                const foreign = await createBranch(db.raw, tracker);
                await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { branchId: foreign.id } });
            }
            await f.retry.update(branchId, f.rule.id, true);
            const original = await firstAttempt(f);
            advance(originalDue, 65);
            const clientUnavailable = condition === "deleted client" || condition === "wrong client tenant";
            if (clientUnavailable) {
                expect(original).toMatchObject({ recoveryState: "eligible", recoveryReason: "live_unsigned_contract" });
                const data = condition === "deleted client"
                    ? { deletedAt: new Date() }
                    : { branchId: (await createBranch(db.raw, tracker)).id };
                await independent.raw.client.update({ where: { id: f.client.id }, data });
            }
            if (condition === "void" || condition === "purge") {
                await db.raw.eformsign_doc.update({ where: { id: document.id },
                    data: condition === "void" ? { voidedAt: new Date() } : { permanentPurgeRequestedAt: new Date() } });
            } else if (condition === "replacement") {
                await syncGeneration(await makeContract(f.client.id), "signed", true);
            } else if (condition === "revoke") {
                await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { statusType: "090",
                    detailPayload: mirrorDetail({ documentId: document.documentId, statusType: "090", updatedDate: new Date() }) as unknown as Prisma.InputJsonObject } });
            }
            await f.trigger.dispatchDueJobs();
            expect(await getOriginal(f.rule.id)).toMatchObject({ recoveryState: "ineligible_terminal", nextCheckAt: null });
            if (clientUnavailable) {
                await independent.raw.client.update({ where: { id: f.client.id }, data: { branchId, deletedAt: null } });
            }
            await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { voidedAt: null, permanentPurgeRequestedAt: null, branchId } });
            await syncGeneration(document, "signed", true);
            advance(originalDue, 120);
            await f.trigger.wakeReceiptRecovery(branchId, f.client.id);
            await f.trigger.dispatchDueJobs();
            await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        },
    );

    it.each(paired(["initial", "post-refresh"] as const))("toggle %s propagates the %s preflight file read error", async (enabled, site) => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "signed", false);
        await f.retry.update(branchId, f.rule.id, enabled);
        const read = jest.spyOn(f.mirror, "findFile");
        if (site === "post-refresh") {
            read.mockResolvedValueOnce(null);
            f.vendor.syncDocument.mockImplementationOnce(async () => { await syncGeneration(document, "signed", true); });
        }
        read.mockRejectedValueOnce(new Error("local read failed"));
        const original = await firstAttempt(f);
        expect(read).toHaveBeenCalledTimes(site === "initial" ? 1 : 2);
        expect(f.vendor.syncDocument).toHaveBeenCalledTimes(site === "initial" ? 0 : 1);
        expect(original).toMatchObject({ ...noRecovery, status: "failed", attempts: 0, cancelReason: "local read failed" });
        expect(await db.raw.message_trigger_job.count({ where: { originalJobId: original.id } })).toBe(0);
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, state: "accepted" } })).toBe(0);
        expect(sendSms).not.toHaveBeenCalled();
    });

    it.each(paired(["boundary error", "partial", "failed", "pending", "unidentified", "proof error"] as const))(
        "toggle %s protects a %s PDF refusal without enrolling it", async (enabled, site) => {
            const f = await fixture();
            const document = await makeContract(f.client.id);
            const readable = site === "boundary error";
            const syncStatus = site === "unidentified" || site === "proof error" ? "syncing" : site;
            await syncGeneration(document, "signed", readable, readable ? "ready" : syncStatus);
            if (site === "partial") await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { syncError: "Files not ready: document" } });
            if (site === "unidentified") await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { detailSyncedAt: null } });
            if (readable || site === "proof error") {
                const actualRead = f.mirror.findFile.bind(f.mirror);
                jest.spyOn(f.mirror, "findFile").mockImplementationOnce(actualRead)
                    .mockRejectedValueOnce(new Error("local read failed"));
            }
            await f.retry.update(branchId, f.rule.id, enabled);
            const original = await firstAttempt(f);
            expect(original).toMatchObject({ ...terminal, cancelReason: skip("pdf_unavailable") });
            await outcomes(original, noDelivery);
            advance(originalDue, 2);
            await syncGeneration(document, "signed", true);
            await f.trigger.wakeReceiptRecovery(branchId, f.client.id);
            await f.trigger.dispatchDueJobs();
            await outcomes(original, noDelivery);
        },
    );

    it.each(paired(["072", "070", "071", "legacy branch"] as const))("toggle %s sends an ordinary signed %s receipt", async (enabled, status) => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "signed", true);
        if (status === "legacy branch") {
            await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { branchId: null } });
        } else {
            await db.raw.eformsign_doc.update({ where: { id: document.id }, data: {
                // A stale projection is not a stricter signature gate than the live detail.
                statusType: status === "070" ? "998" : status,
                detailPayload: mirrorDetail({ documentId: document.documentId, statusType: status, updatedDate: beforeDue,
                    stepType: status === "070" ? "06" : "05", stepName: status === "070" ? "제공기관 확인" : "고객 서명" }) as unknown as Prisma.InputJsonObject,
            } });
        }
        await f.retry.update(branchId, f.rule.id, enabled);
        const original = await firstAttempt(f);
        await expectOrdinarySent(original);
    });

    async function expectOrdinarySent(original: message_trigger_job) {
        expect(original).toMatchObject({ ...noRecovery, status: "sent", attempts: 0, cancelReason: null });
        expect(await db.raw.message_trigger_job.count({ where: { originalJobId: original.id } })).toBe(0);
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, state: "accepted", slot: { not: null } } })).toBe(1);
        expect(sendSms).toHaveBeenCalledTimes(1);
    }

    it.each(["throws", "returns terminal absence"] as const)("rechecks a due eligible original when the admission file read %s", async fault => {
        const f = await fixture();
        const { original, document } = await eligibleUnsignedReceipt(f);
        advance(originalDue, 1);
        const now = new Date();
        await syncGeneration(document, "signed", true);
        const read = jest.spyOn(f.mirror, "findFile");
        if (fault === "throws") read.mockRejectedValueOnce(new Error("local read failed"));
        else read.mockResolvedValueOnce(null);
        await f.trigger.sweepReceiptRecovery(now);
        expect(await getOriginal(f.rule.id)).toMatchObject({
            status: "canceled", attempts: original.attempts, cancelReason: original.cancelReason, canceledAt: original.canceledAt,
            scheduledFor: original.scheduledFor, recoveryReason: original.recoveryReason, firstBlockedAt: original.firstBlockedAt,
            recoveryEpoch: original.recoveryEpoch, recoveryState: fault === "throws" ? "eligible" : "ineligible_terminal",
            nextCheckAt: fault === "throws" ? new Date(now.getTime() + 60_000) : null,
        });
        await outcomes(original, noDelivery);
        advance(now, 1);
        await f.trigger.dispatchDueJobs();
        await outcomes(original, fault === "throws" ? { children: 1, accepted: 1, calls: 1 } : noDelivery);
    });

    it.each(["committed syncing PDF", "legacy null branch signing"] as const)(
        "wakes recovery after real mirror sync of %s before the due sweep", async scenario => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        const legacy = scenario === "legacy null branch signing";
        await f.retry.update(branchId, f.rule.id, true);
        let original: message_trigger_job;
        if (legacy) {
            await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { branchId: null } });
            await syncGeneration(document, "unsigned", false);
            original = await firstAttempt(f);
            expect(original).toMatchObject({ recoveryReason: "live_unsigned_contract", recoveryState: "eligible" });
        }
        const sourceUpdatedDate = legacy ? originalDue : beforeDue;
        const detail = mirrorDetail({ documentId: document.documentId, statusType: "070", updatedDate: sourceUpdatedDate });
        let enteredDownload!: () => void;
        let finishDownload!: () => void;
        const downloading = new Promise<void>(resolve => { enteredDownload = resolve; });
        const resume = new Promise<void>(resolve => { finishDownload = resolve; });
        const credentials = { withCredentials: (_owner: unknown, _scope: unknown,
            callback: (credential: { accessToken: string }) => unknown) => callback({ accessToken: "synthetic" }) };
        const owner = new MirrorUnassignedEformsignDocUsecase(credentials as never, {} as never, f.docRepo);
        const mirrorService = new EformsignDocumentMirrorService({ getDocument: async () => detail } as never,
            credentials as never, f.mirror, owner, {} as never, {
                downloadDocumentFile: async (_token: string, _id: string, kind: string) => {
                    if (kind === "document") {
                        enteredDownload();
                        await resume;
                    }
                    return { status: 200, body: pdf, contentType: "application/pdf", contentDisposition: null };
                },
            } as never, undefined, undefined, undefined, f.trigger);
        const principal = { branchId, source: "worker" } as const;
        const syncOptions = { skipClientReconciliation: true, skipBranchOwnedProjection: legacy };
        const syncing = mirrorService.syncDocument(document.documentId, principal,
            { ...syncOptions, suppressOutboundAutomation: legacy });
        try {
            await Promise.race([downloading, syncing.then(() => { throw new Error("Mirror completed before its document download"); })]);
            expect(await f.mirror.findState(document.documentId)).toMatchObject({
                syncStatus: "syncing", syncError: null, permanentPurgeRequestedAt: null,
                detailSourceUpdatedDate: sourceUpdatedDate, detailSyncedAt: sourceUpdatedDate, branchId: legacy ? null : branchId,
            });
            expect(await f.mirror.findFile(document.documentId, "document")).toBeNull();
            if (!legacy) {
                original = await firstAttempt(f);
                expect(f.vendor.syncDocument).toHaveBeenCalledTimes(1);
                expect(original).toMatchObject({ recoveryReason: "current_contract_pdf_pending", recoveryState: "eligible" });
            }
            expect(await f.mirror.findFile(document.documentId, "document")).toBeNull();
        } finally {
            finishDownload();
            await syncing;
        }
        if (legacy) {
            await outcomes(original!, noDelivery);
            await mirrorService.syncDocument(document.documentId, principal, syncOptions);
        }
        const admitted = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original!.id } });
        expect(admitted.createdAt.getTime()).toBeLessThan(original!.nextCheckAt!.getTime());
        await f.trigger.dispatchPendingJobNow(admitted.id, { expectedBranchId: branchId });
        await outcomes(original!, { children: 1, accepted: 1, calls: 1 });
    });

    it.each(paired(["foreign selection", "foreign mirror branch", "different mirror id", "terminal stale review", "void", "purge"] as const))(
        "toggle %s protects the current contract with %s even with an older signed contract", async (enabled, scenario) => {
            const terminalWithNoBirthday = scenario === "terminal stale review";
            const f = await fixture(terminalWithNoBirthday ? null : undefined);
            await syncGeneration(await makeContract(f.client.id), "signed", true);
            const current = await makeContract(f.client.id);
            await syncGeneration(current, "signed", true);
            const foreign = (await createBranch(db.raw, tracker)).id;
            let refusal: keyof typeof RECEIPT_LINK_SKIP_MESSAGES = "contract_not_signed";
            if (scenario === "foreign selection") {
                await db.raw.eformsign_doc.update({ where: { id: current.id }, data: { branchId: foreign } });
            } else if (scenario === "foreign mirror branch" || scenario === "different mirror id") {
                const read = f.mirror.findState.bind(f.mirror);
                jest.spyOn(f.mirror, "findState").mockImplementationOnce(async documentId => {
                    const result = await read(documentId);
                    expect(documentId).toBe(current.documentId);
                    if (!result) return result;
                    return scenario === "foreign mirror branch" ? { ...result, branchId: foreign } : { ...result, documentId: "different-id" };
                });
            } else if (scenario === "terminal stale review") {
                await db.raw.eformsign_doc.update({ where: { id: current.id }, data: {
                    statusType: "090", detailPayload: mirrorDetail({ documentId: current.documentId, statusType: "090",
                        updatedDate: beforeDue, stepType: "06", stepName: "제공기관 확인" }) as unknown as Prisma.InputJsonObject,
                } });
            } else {
                refusal = scenario === "void" ? "contract_voided" : "no_contract_document";
                await db.raw.eformsign_doc.update({ where: { id: current.id },
                    data: scenario === "void" ? { voidedAt: beforeDue } : { permanentPurgeRequestedAt: beforeDue } });
            }
            await f.retry.update(branchId, f.rule.id, enabled);
            const original = await firstAttempt(f);
            expect(original).toMatchObject({ ...terminal, cancelReason: skip(refusal) });
            await outcomes(original, noDelivery);
            advance(originalDue, 2);
            await db.raw.eformsign_doc.update({ where: { id: current.id }, data: { branchId, voidedAt: null, permanentPurgeRequestedAt: null } });
            await syncGeneration(current, "signed", true);
            if (terminalWithNoBirthday) await f.clients.update(branchId, f.client.id, { birthday: "19940510" });
            await f.trigger.wakeReceiptRecovery(branchId, f.client.id);
            await f.trigger.dispatchDueJobs();
            await outcomes(original, noDelivery);
        },
    );

    async function configureQuietHold(f: Awaited<ReturnType<typeof fixture>>, start = "09:30", end = "10:30") {
        const { version, configuration } = await f.settings.getMessageAutomationPolicyConfig(branchId);
        await f.settings.setMessageAutomationPolicyConfig(branchId, version, {
            ...configuration,
            quietHours: { ...configuration.quietHours, enabled: true, action: "DEFER", start, end, recipientGroups: ["CLIENT"] },
        });
    }

    async function stripStagedGeneration(job: message_trigger_job, malformed = false) {
        const payload = job.payload as { templateVariables: Record<string, string> };
        const snapshot = JSON.parse(payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE]!);
        expect(snapshot.receiptGeneration).toMatchObject({ documentId: expect.any(Number), sha256: pdfDigest });
        if (malformed) snapshot.receiptGeneration = null;
        else delete snapshot.receiptGeneration;
        await db.raw.message_trigger_job.update({ where: { id: job.id }, data: {
            payload: { ...payload, templateVariables: {
                ...payload.templateVariables, [SMS_DELIVERY_SNAPSHOT_VARIABLE]: JSON.stringify(snapshot),
            } },
        } });
    }

    it.each(paired(["ready", "expired at validation", "expires before provider", "malformed generation", "foreign token", "revoked token", "replaced contract", "unreadable at provider"] as const))(
        "toggle %s releases a pre-upgrade quiet hold with %s", async (enabled, site) => {
            const f = await fixture();
            const document = await makeContract(f.client.id);
            await syncGeneration(document, "signed", true);
            await configureQuietHold(f);
            await f.retry.update(branchId, f.rule.id, enabled);
            const original = await firstAttempt(f);
            const release = new Date("2026-11-24T01:30:00.000Z");
            expect(original).toMatchObject({ ...noRecovery, status: "pending", attempts: 0, nextAttemptAt: release });
            const log = await db.raw.message_log.findFirstOrThrow({ where: { branchId, triggerJobId: original.id } });
            expect(log).toMatchObject({ providerAcceptanceState: "prepared", providerCallStartedAt: null,
                variables: expect.objectContaining({ quietHoursDisposition: "DEFER", quietHoursReleaseAt: release.toISOString() }) });
            const token = await db.raw.receipt_link_token.findFirstOrThrow({ where: { branchId, eformsignDocId: document.id, active: true } });
            expect(token).toMatchObject({ kind: "contract", clientId: f.client.id });
            await stripStagedGeneration(original, site === "malformed generation");
            jest.setSystemTime(release);
            if (site === "expired at validation" || site === "expires before provider") {
                await independent.raw.receipt_link_token.update({ where: { id: token.id }, data: {
                    expiresAt: new Date(release.getTime() + (site === "expired at validation" ? -1 : 1)),
                } });
            } else if (site === "foreign token") {
                await independent.raw.receipt_link_token.update({ where: { id: token.id }, data: { branchId: (await createBranch(db.raw, tracker)).id } });
            } else if (site === "revoked token") {
                await independent.raw.receipt_link_token.update({ where: { id: token.id }, data: { active: false, revokedAt: release } });
            } else if (site === "replaced contract") {
                await syncGeneration(await makeContract(f.client.id), "signed", true);
            }

            const fresh = worker(independent);
            try {
                if (site === "expires before provider" || site === "unreadable at provider") {
                    const pause = pauseAfterPreparation(fresh);
                    const sending = fresh.trigger.dispatchDueJobs();
                    try {
                        await Promise.race([pause.prepared, sending.then(() => { throw new Error("Release finished without preparation"); })]);
                        if (site === "expires before provider") jest.setSystemTime(new Date(release.getTime() + 1));
                        else jest.spyOn(fresh.mirror, "findFile").mockRejectedValueOnce(new Error("local read failed"));
                    } finally {
                        pause.resume();
                        await sending;
                    }
                } else {
                    await fresh.trigger.dispatchDueJobs();
                }
                const after = await getOriginal(f.rule.id);
                expect(fresh.storage.upload).not.toHaveBeenCalled();
                expect(f.storage.upload).toHaveBeenCalledTimes(1);
                if (site === "ready") {
                    await expectOrdinarySent(after);
                    expect(sendSms.mock.calls[0]?.[0].message).toBe(log.messageBody);
                    expect(await db.raw.receipt_link_token.findUnique({ where: { id: token.id } })).toEqual(token);
                    await fresh.trigger.dispatchDueJobs();
                    expect(sendSms).toHaveBeenCalledTimes(1);
                } else {
                    if (site === "expired at validation" || site === "replaced contract" || site === "foreign token" || site === "revoked token") {
                        expect(after).toMatchObject({ ...terminal, canceledAt: release, firstBlockedAt: release,
                            cancelReason: "메시지 발송 건너뜀: 승인된 영수증 링크가 만료되었거나 취소되어 재시도하지 않았습니다" });
                    } else {
                        expect(after).toMatchObject({ ...noRecovery, canceledAt: new Date(), status: "canceled", attempts: 0,
                            cancelReason: "receipt_recovery_not_proven" });
                    }
                    await outcomes(after, noDelivery);
                    if (site === "revoked token") {
                        expect(await db.raw.receipt_link_token.findUnique({ where: { id: token.id } }))
                            .toMatchObject({ active: false, revokedAt: release });
                    }
                }
            } finally {
                if (site === "foreign token") {
                    await independent.raw.receipt_link_token.update({ where: { id: token.id }, data: { branchId } });
                }
            }
        },
    );

    it("refuses the ordinary legacy fallback for a quiet-held recovered child", async () => {
        const { f, original, child } = await admittedChild();
        await configureQuietHold(f, "14:30", "15:30");
        advance(child.scheduledFor, 1);
        await f.trigger.dispatchDueJobs();
        const held = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: child.id } });
        const release = new Date("2026-11-24T06:30:00.000Z");
        expect(held).toMatchObject({ status: "pending", nextAttemptAt: release });
        await stripStagedGeneration(held);
        jest.setSystemTime(release);
        await worker(independent).trigger.dispatchDueJobs();
        expect(await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({
            status: "canceled", cancelReason: "receipt_recovery_not_proven",
        });
        await outcomes(original, { children: 1, accepted: 0, calls: 0 });
    });

    it("moves waiting parents behind a ready parent after a missed wake", async () => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "unsigned", false);
        await f.retry.update(branchId, f.rule.id, true);
        const original = await firstAttempt(f);
        advance(originalDue, 65);
        const now = new Date();
        await syncGeneration(document, "signed", true);
        const readyCheckAt = original.nextCheckAt!;
        const waiting = await fixture();
        const waitingDoc = await makeContract(waiting.client.id);
        await syncGeneration(waitingDoc, "unsigned", false);
        const epoch = await waiting.retry.update(branchId, waiting.rule.id, true);
        const earlier = new Date(readyCheckAt.getTime() - 1);
        await db.raw.message_trigger_job.createMany({ data: Array.from({ length: 101 }, (_, i) => ({
            branchId, clientId: waiting.client.id, ruleId: waiting.rule.id, recipientType: "CLIENT",
            templateKey: "SERVICE_END_NOTICE", scheduledFor: originalDue, status: "canceled", canceledAt: originalDue,
            firstBlockedAt: originalDue, recoveryState: "eligible", recoveryReason: "live_unsigned_contract",
            recoveryEpoch: new Date(epoch.enabledAt!), nextCheckAt: earlier, dedupeKey: `waiting-receipt:${waiting.rule.id}:${i}`,
            payload: { receiptRecovery: { event: "SERVICE_END", slot: `rule:${waiting.rule.id}`, documentId: waitingDoc.id } },
        })) });
        await f.trigger.sweepReceiptRecovery(now);
        expect(await db.raw.message_trigger_job.count({ where: { originalJobId: original.id } })).toBe(0);
        expect(await db.raw.message_trigger_job.count({ where: { ruleId: waiting.rule.id, nextCheckAt: { gt: now } } })).toBe(100);
        await f.trigger.sweepReceiptRecovery(now);
        await f.trigger.dispatchDueJobs();
        await outcomes(original, { children: 1, accepted: 1, calls: 1 });
    });

    async function manuallyAdmit(f: Awaited<ReturnType<typeof fixture>>, result: "accepted" | "uncertain" | "in_flight") {
        const row = await createMessageLog(db.raw, tracker, {
            branchId, clientId: f.client.id, receiver: f.client.phone!, providerAcceptanceState: "prepared",
            templateKey: "MANUAL_SMS", providerAcceptanceKey: randomUUID(), providerAcceptanceFingerprint: randomUUID(),
            variables: manualTemplateVariables({ kind: "system", key: "SERVICE_END_NOTICE" }),
        });
        const log = await f.acceptance.beginProviderCall(MessageLogMapper.toDomain(row));
        if (result === "accepted") {
            await sendSms({ receiver: f.client.phone! });
            log.recordProviderResult({ accepted: true, providerMessageId: String(row.id) });
            await f.acceptance.persist(log);
        } else if (result === "uncertain") {
            log.providerAcceptanceState = "uncertain";
            log.status = "failed";
            await f.acceptance.persist(log);
        }
        return log;
    }

    it("blocks recovery after a matching accepted manual and permits a second explicit manual", async () => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "unsigned", false);
        await f.retry.update(branchId, f.rule.id, true);
        const original = await firstAttempt(f);
        await manuallyAdmit(f, "accepted");
        advance(originalDue, 65);
        await syncGeneration(document, "signed", true);
        await f.trigger.dispatchDueJobs();
        await outcomes(original, { children: 0, accepted: 0, calls: 1 });
        await manuallyAdmit(f, "accepted");
        expect(await db.raw.message_occurrence_manual_attempt.count({ where: { branchId, state: "accepted" } })).toBe(2);
        await outcomes(original, { children: 0, accepted: 0, calls: 2 });
    });

    it.each(["in_flight", "uncertain"] as const)("holds a child while a manual attempt is %s", async state => {
        const { f, original, child } = await admittedChild();
        const manual = await manuallyAdmit(f, state);
        await f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        const held = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: child.id } });
        expect(held).toMatchObject({ status: "pending", claimToken: null });
        expect(held.nextAttemptAt).not.toBeNull();
        await outcomes(original, { children: 1, accepted: 0, calls: 0 });
        if (state === "uncertain") {
            await f.acceptance.reconcile({ branchId, logId: manual.id, actor: "qa",
                reason: "synthetic definite provider refusal", outcome: "not-delivered" });
        } else {
            manual.recordProviderResult({ accepted: false, errorMessage: "definitely declined" });
            await f.acceptance.persist(manual);
        }
        jest.setSystemTime(held.nextAttemptAt!);
        await f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        await outcomes(original, { children: 1, accepted: 1, calls: 1 });
    });

    it("cannot acquire an epoch enabled during its own first preparation", async () => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "unsigned", false);
        const barrier = pauseAfterPreparation(f);
        const inflight = firstAttempt(f);
        try {
            await barrier.prepared;
            await worker(independent).retry.update(branchId, f.rule.id, true);
        } finally {
            barrier.resume();
            await inflight;
        }
        const original = await getOriginal(f.rule.id);
        expect(original).toMatchObject({ recoveryReason: "live_unsigned_contract", recoveryState: "ineligible_terminal", recoveryEpoch: null });
        jest.setSystemTime(nineDaysLater);
        await syncGeneration(document, "signed", true);
        await f.trigger.dispatchDueJobs();
        await outcomes(original, { children: 0, accepted: 0, calls: 0 });
    });

    it("rematerializes a real ordinary consent refusal without recording a recovery epoch", async () => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "signed", true);
        await f.retry.update(branchId, f.rule.id, true);
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        const job = await getOriginal(f.rule.id);
        await db.raw.message_trigger_job.update({ where: { id: job.id }, data: {
            payload: { ...(job.payload as Prisma.JsonObject), [AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY]: { stale: true } },
        } });
        jest.setSystemTime(originalDue);
        await f.trigger.dispatchDueJobs();
        expect(await getOriginal(f.rule.id)).toMatchObject({ status: "canceled", cancelReason: AUTOMATION_CONSENT_CANCEL_REASON, recoveryEpoch: null });
        expect(sendSms).not.toHaveBeenCalled();
        advance(originalDue, 300);
        await f.clients.update(branchId, f.client.id, { name: "QA-동의 확인" });
        expect(await getOriginal(f.rule.id)).toMatchObject({ id: job.id, status: "pending", recoveryReason: null, recoveryEpoch: null });
        await f.trigger.dispatchDueJobs();
        expect(await getOriginal(f.rule.id)).toMatchObject({ id: job.id, status: "sent", originalJobId: null });
        expect(sendSms).toHaveBeenCalledTimes(1);
    });

    it("rematerializes a receipt canceled by the real Client data changed path", async () => {
        const f = await fixture();
        await syncGeneration(await makeContract(f.client.id), "signed", true);
        await f.retry.update(branchId, f.rule.id, true);
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        const original = await getOriginal(f.rule.id);

        advance(originalDue, 300);
        await f.clients.update(branchId, f.client.id, { endDate: "2026-11-25", allowBusinessDayMismatch: true });
        expect(await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
            status: "canceled", cancelReason: "Client data changed", firstBlockedAt: null, recoveryEpoch: null,
        });
        await f.clients.update(branchId, f.client.id, { endDate: "2026-11-24", allowBusinessDayMismatch: true });
        expect(await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
            status: "pending", scheduledFor: originalDue, canceledAt: null, recoveryReason: null, recoveryEpoch: null,
        });
        await f.trigger.dispatchDueJobs();
        const rows = await db.raw.message_trigger_job.findMany({ where: { branchId, ruleId: f.rule.id } });
        expect(rows).toHaveLength(2);
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: original.id, status: "sent", originalJobId: null, recoveryEpoch: null }),
            expect.objectContaining({ status: "canceled", cancelReason: "Client data changed", originalJobId: null }),
        ]));
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, slot: { not: null }, state: "accepted" } })).toBe(1);
        expect(sendSms).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])("suppresses a changed-key catch-up with preserveExisting=%s", async preserveExisting => {
        const f = await fixture();
        const { original } = await eligibleUnsignedReceipt(f);
        const unrelated = await createMessageTriggerRule(db.raw, tracker, { branchId, eventType: "SERVICE_END",
            offsetType: "SAME_DAY", sendTime: "11:00", templateKey: "THANKS", isActive: true });
        await f.settings.setMessageSettingsPolicyEnabled(branchId, "past-trigger", true);
        advance(originalDue, 300);
        const catchUpAt = new Date();
        const catchUpKey = receiptKey(f.rule.id, f.client.id, catchUpAt);
        expect(catchUpKey).not.toBe(original.dedupeKey);
        const persist = jest.spyOn(f.jobs, "upsertPendingForRuleGeneration");
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, true, false, { stableBatchAt: catchUpAt, preserveExisting });
        expect(persist).toHaveBeenCalledWith(expect.objectContaining({
            dedupeKey: catchUpKey, payload: expect.objectContaining({
                catchUp: expect.objectContaining({ originalScheduledFor: originalDue.toISOString() }),
            }),
        }), expect.any(Date), false, preserveExisting, expect.anything());
        const next = await getOriginal(unrelated.id);
        expect(next).toMatchObject({ status: "pending", scheduledFor: catchUpAt,
            payload: { catchUp: { sequence: 1, predecessorDedupeKey: null } } });
        await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        await f.trigger.dispatchDueJobs();
        expect(await getOriginal(unrelated.id)).toMatchObject({ id: next.id, status: "sent" });
        await outcomes(original, { children: 0, accepted: 1, calls: 1 });
        expect(await getOriginal(f.rule.id)).toMatchObject({ recoveryState: "eligible", dedupeKey: original.dedupeKey });
    });

    it.each(["same key", "changed key"] as const)("protects a typed original through a %s rule rebuild", async key => {
        const f = await fixture();
        const { document, original } = await eligibleUnsignedReceipt(f);
        advance(originalDue, 300);
        const editAt = new Date();
        const changed = key === "changed key";
        const currentDue = changed ? new Date("2026-11-24T07:00:00.000Z") : originalDue;
        const candidateKey = receiptKey(f.rule.id, f.client.id, currentDue);
        expect(candidateKey === original.dedupeKey).toBe(!changed);
        const persist = jest.spyOn(f.jobs, "upsertPendingForRuleGeneration");
        await f.trigger.updateRule(branchId, f.rule.id, changed ? { sendTime: "16:00" } : { name: "QA-영수증 규칙 수정" });
        expect(persist).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: candidateKey }),
            expect.any(Date), true, false, expect.anything());
        expect(await db.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: f.rule.id } }))
            .toMatchObject({ jobsStale: false, sendTime: changed ? "16:00" : "10:00" });
        await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        await expectReceiptRecoveryAt(f, document, original, changed ? currentDue : editAt);
    });

    it("suppresses an unlinked receipt after a real client contract date edit changes its key", async () => {
        const f = await fixture();
        const { document, original } = await eligibleUnsignedReceipt(f);
        advance(originalDue, 300);
        const currentDue = new Date("2026-11-25T01:00:00.000Z");
        const candidateKey = receiptKey(f.rule.id, f.client.id, currentDue);
        expect(candidateKey).not.toBe(original.dedupeKey);
        const persist = jest.spyOn(f.jobs, "upsertPendingForRuleGeneration");
        await f.clients.update(branchId, f.client.id, { endDate: "2026-11-25", allowBusinessDayMismatch: true });
        expect(persist).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: candidateKey }),
            expect.any(Date), false, false, expect.anything());
        await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        await expectReceiptRecoveryAt(f, document, original, currentDue);
    });

    it("moves only the operator reservation and cannot move it onto a protected receipt key", async () => {
        const f = await fixture();
        const { original } = await eligibleUnsignedReceipt(f);
        const reservationDue = new Date("2026-11-25T01:00:00.000Z");
        const reservation = await createMessageTriggerJob(db.raw, tracker, { ruleId: f.rule.id }, {
            branchId, clientId: f.client.id, templateKey: "SERVICE_END_NOTICE", recipientPhone: original.recipientPhone,
            status: "needs_setup", cancelReason: "QA-operator reservation", scheduledFor: reservationDue,
            dedupeKey: receiptKey(f.rule.id, f.client.id, reservationDue),
        });
        const scope = { startDate: false, endDate: true, scheduleIds: [] };
        const movedDue = new Date("2026-11-26T01:00:00.000Z");
        advance(originalDue, 300);
        await independent.raw.client.update({ where: { id: f.client.id }, data: { endDate: new Date("2026-11-26") } });
        await f.trigger.reconcileServiceRecordDateRules(branchId, f.client.id, scope);
        const moved = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: reservation.id } });
        expect(moved).toMatchObject({ status: "needs_setup", scheduledFor: movedDue, cancelReason: reservation.cancelReason,
            dedupeKey: receiptKey(f.rule.id, f.client.id, movedDue) });

        await independent.raw.client.update({ where: { id: f.client.id }, data: { endDate: new Date("2026-11-24") } });
        await f.trigger.reconcileServiceRecordDateRules(branchId, f.client.id, scope);
        await f.trigger.dispatchDueJobs();
        expect(await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: reservation.id } })).toEqual(moved);
        expect(await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
            status: "canceled", canceledAt: original.canceledAt, scheduledFor: originalDue, dedupeKey: original.dedupeKey,
            recoveryState: "eligible",
        });
        expect(await db.raw.message_trigger_job.count({ where: { branchId, ruleId: f.rule.id } })).toBe(2);
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, slot: { not: null }, state: "accepted" } })).toBe(0);
        expect(sendSms).not.toHaveBeenCalled();
    });

    it.each([
        { edit: "same key", dates: ["2026-11-20", "2026-11-23", "2026-11-24"], startDate: true, endDate: false },
        { edit: "changed key", dates: ["2026-11-19", "2026-11-23", "2026-11-25"], startDate: false, endDate: true },
    ] as const)("protects a typed original through a confirmed payroll date edit with $edit", async ({ dates, startDate, endDate }) => {
        const f = await fixture();
        const client = await db.raw.client.update({ where: { id: f.client.id }, data: {
            startDate: new Date("2026-11-19"), duration: 3, bookingConfirmedAt: beforeDue,
            fullPrice: "150000", grant: "90000", actualPrice: "60000",
        } });
        const employee = await createEmployee(db.raw, tracker, { branchId });
        const schedule = await createEmployeeSchedule(db.raw, tracker, { clientId: client.id, primaryEmployeeId: employee.id }, {
            branchId, startDate: new Date("2026-11-19"), endDate: new Date("2026-11-24"),
        });
        const record = await db.raw.service_record_case.create({ data: {
            branchId, clientId: client.id, startDate: client.startDate, endDate: client.endDate, requiredSessionCount: 3,
            status: "IN_PROGRESS", momName: client.name,
        } });
        await db.raw.service_record_assignment.create({ data: {
            branchId, serviceRecordCaseId: record.id, scheduleId: schedule.id, employeeId: employee.id,
            employeeNameSnapshot: employee.name, startDate: schedule.startDate, endDate: schedule.endDate,
        } });
        const actor = await createUser(db.raw, tracker, { role: "admin" }, { membership: { branchId, role: "admin" } });
        const { document, original } = await eligibleUnsignedReceipt(f);
        advance(originalDue, 300);
        const admissionAt = new Date();

        const editor = new AdminServiceRecordEditService(new ServiceRecordEditRepository(independent.service),
            new HolidayCalendarService(new SbHolidayCalendarRepository(independent.service)));
        const started = await editor.startDraft(branchId, client.id, actor.id);
        if (!started.draft) throw new Error("Missing payroll date draft");
        const saved = await editor.updateDraft(branchId, started.draft.id, actor.id, {
            expectedDraftVersion: started.draft.draftVersion, changes: {},
            schedule: { serviceDays: { saturday: false, sunday: false, holiday: false }, dates: [...dates] },
        });
        if (!saved.draft) throw new Error("Missing saved payroll date draft");
        const draftVersion = { expectedDraftVersion: saved.draft.draftVersion };
        const preview = await editor.previewDraft(branchId, saved.draft.id, actor.id, draftVersion);
        expect(preview.blockingReasons).toEqual([]);
        await expect(editor.confirmDraft(branchId, saved.draft.id, actor.id, {
            ...draftVersion, previewId: preview.previewId, idempotencyKey: randomUUID(),
        })).resolves.toMatchObject({ status: "confirmed" });
        const [start, , end] = dates;
        expect(await db.raw.client.findUniqueOrThrow({ where: { id: client.id } }))
            .toMatchObject({ startDate: new Date(start), endDate: new Date(end) });

        const intent = await db.raw.message_trigger_job.findFirstOrThrow({
            where: { branchId, clientId: client.id, payload: { path: ["templateVariables", "intentKind"], equals: "client_dates" } },
        });
        const dateScope = { startDate, endDate, scheduleIds: [schedule.id] };
        expect(intent).toMatchObject({
            nextAttemptAt: intent.scheduledFor, payload: { templateVariables: { dateScope: JSON.stringify(dateScope) } },
        });
        // The intent claim uses PostgreSQL's clock, which Jest's fake time does not advance.
        await db.raw.message_trigger_job.update({ where: { id: intent.id }, data: { nextAttemptAt: new Date(0) } });
        await expect(f.intents.fulfillClientDateIntent({
            branchId, clientId: client.id, dedupeKey: intent.dedupeKey, intentAt: intent.scheduledFor,
            dateScope,
        })).resolves.toBe(true);
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: intent.id } })).toBeNull();
        const currentDue = new Date(`${end}T01:00:00.000Z`);
        const candidateKey = receiptKey(f.rule.id, client.id, currentDue);
        expect(candidateKey === original.dedupeKey).toBe(!endDate);
        await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        expect(await getOriginal(f.rule.id)).toMatchObject({ dedupeKey: original.dedupeKey, recoveryState: "eligible" });
        await expectReceiptRecoveryAt(f, document, original, endDate ? currentDue : admissionAt);
    });

    it("recognizes only the exact ordinary scheduling, policy, timing and duplicate dispositions", async () => {
        const f = await fixture();
        const reasons = [
            "Client data changed", "Service record dates changed", "Rule updated", "규칙 재생성", "Rule deactivated",
            "Message automation parent disabled", AUTOMATION_CONSENT_CANCEL_REASON, "message_quiet_hours:CANCEL",
            "sms_automation_safeguard:branch", "sms_automation_safeguard:rule", "sms_automation_safeguard:recipient",
            "expired_after_quiet", "보충 발송 이전 순위 job 없음", "duplicate_at_release", "OCCURRENCE_ALREADY_ACCEPTED",
            "target_client_status_mismatch: 규칙의 대상 고객 상태와 고객의 현재 상태가 달라 발송하지 않았습니다",
            ...Array.from({ length: 720 }, (_, i) => `기존 발송 예정 ${i + 1}시간 경과`),
        ];
        const keys = reasons.map((_, i) => `ordinary-receipt:${i}`);
        const disallowed = [null, "Client data changed again", "기존 발송 예정 0시간 경과", "기존 발송 예정 721시간 경과",
            "메시지 발송 건너뜀: 이전 영수증 관련 기록", MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON];
        await db.raw.message_trigger_job.createMany({ data: [...reasons, ...disallowed].map((cancelReason, i) => ({
            branchId, clientId: f.client.id, ruleId: f.rule.id, templateKey: "SERVICE_END_NOTICE", recipientType: "CLIENT",
            status: "canceled", scheduledFor: originalDue, canceledAt: originalDue, cancelReason,
            dedupeKey: keys[i] ?? `protected-receipt:${i}`,
        })) });
        const protectedRows = await db.raw.$queryRaw<Array<{ cancel_reason: string | null }>>(Prisma.sql`
            SELECT stored.cancel_reason FROM message_trigger_job AS stored WHERE stored.branch_id = ${branchId}::uuid
              AND ${protectedReceiptOriginalSql("stored")}
            ORDER BY stored.cancel_reason NULLS FIRST
        `);
        expect(protectedRows.map(row => row.cancel_reason)).toEqual(expect.arrayContaining(disallowed));
        expect(protectedRows).toHaveLength(disallowed.length);
    });

    it.each([null, "이전 영수증 관련 기록", "user", "sender"] as const)(
        "suppresses an unlinked changed-key receipt candidate for legacy disposition %s", async reason => {
            const f = await fixture();
            const document = await makeContract(f.client.id);
            await syncGeneration(document, "unsigned", false);
            const original = await firstAttempt(f);
            const cancelReason = reason === "sender" ? MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON
                : reason === "user" ? "사용자가 발송을 취소함" : reason;
            await db.raw.message_trigger_job.update({ where: { id: original.id }, data: {
                recoveryReason: null, firstBlockedAt: null, recoveryEpoch: null, recoveryState: null, nextCheckAt: null,
                cancelReason, canceledByUser: reason === "user", payload: {},
            } });
            advance(originalDue, 300);
            await syncGeneration(document, "signed", true);
            await f.clients.update(branchId, f.client.id, { endDate: "2026-11-25", allowBusinessDayMismatch: true });
            await f.trigger.reconcileServiceRecordDateRules(branchId, f.client.id, { startDate: false, endDate: true, scheduleIds: [] });
            jest.setSystemTime(new Date("2026-11-25T01:00:00.000Z"));
            await f.trigger.dispatchDueJobs();
            await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        },
    );

    it("rereads a committed due edit before expiring a selected child without a callback", async () => {
        const { f, child, original } = await admittedChild();
        const newDate = new Date("2026-12-10");
        await independent.raw.client.update({ where: { id: f.client.id }, data: { endDate: newDate } });
        jest.setSystemTime(nineDaysLater);
        await f.trigger.dispatchDueJobs();
        const current = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: child.id } });
        expect(current).toMatchObject({ originalJobId: original.id, status: "pending", scheduledFor: new Date("2026-12-10T01:00:00Z"),
            createdAt: child.createdAt });
        await outcomes(original, { children: 1, accepted: 0, calls: 0 });
        jest.setSystemTime(current.scheduledFor);
        await f.trigger.dispatchDueJobs();
        await outcomes(original, { children: 1, accepted: 1, calls: 1 });
    });

    it.each(["accepted", "in_flight", "uncertain"] as const)("blocks the ordinary worker behind a matching manual %s attempt", async state => {
        const f = await fixture();
        const doc = await makeContract(f.client.id);
        await syncGeneration(doc, "signed", true);
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        await manuallyAdmit(f, state);
        jest.setSystemTime(originalDue);
        await f.trigger.dispatchDueJobs();
        expect(await getOriginal(f.rule.id)).toMatchObject({
            status: state === "accepted" ? "canceled" : "pending", recoveryReason: null, originalJobId: null,
        });
        expect(sendSms).toHaveBeenCalledTimes(state === "accepted" ? 1 : 0);
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, slot: { not: null }, state: "accepted" } })).toBe(0);
    });

    it.each([false, true])("rechecks the epoch on an existing definite transport rejection with changed epoch=%s", async changeEpoch => {
        const { f, child, original } = await admittedChild();
        sendSms.mockImplementationOnce(async request => ({
            request: { ...request, msgType: "LMS", testModeYn: "N" },
            response: { result_code: -6, success_cnt: 0, error_cnt: 1, message: "synthetic transient rejection", msg_id: 0 },
        }));
        await f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        const rejected = await db.raw.message_log.findFirstOrThrow({ where: { branchId, triggerJobId: child.id } });
        expect(rejected).toMatchObject({ providerAcceptanceState: "rejected" });
        expect(rejected.nextRetryAt).not.toBeNull();
        if (changeEpoch) {
            await f.retry.update(branchId, f.rule.id, false);
            await f.retry.update(branchId, f.rule.id, true);
        }
        jest.setSystemTime(rejected.nextRetryAt!);
        await f.transport.retry(MessageLogMapper.toDomain(rejected), "automatic");
        await outcomes(original, { children: 1, accepted: changeEpoch ? 0 : 1, calls: changeEpoch ? 1 : 2 });
    });

    it("rereads the exact epoch after dispatch authorization and before provider start", async () => {
        const { f, child, original } = await admittedChild();
        let reached!: () => void;
        let resume!: () => void;
        const authorized = new Promise<void>(resolve => { reached = resolve; });
        const paused = new Promise<void>(resolve => { resume = resolve; });
        const send = f.delivery.sendPreparedJob.bind(f.delivery);
        jest.spyOn(f.delivery, "sendPreparedJob").mockImplementationOnce(async (job, preparation) => {
            reached();
            await paused;
            return send(job, preparation);
        });
        const inflight = f.trigger.dispatchPendingJobNow(child.id, { expectedBranchId: branchId });
        try {
            await authorized;
            expect(await db.raw.message_trigger_job.findUnique({ where: { id: child.id } })).toMatchObject({ status: "dispatching" });
            const editor = worker(independent);
            await editor.retry.update(branchId, f.rule.id, false);
            await editor.retry.update(branchId, f.rule.id, true);
        } finally {
            resume();
            await inflight;
        }
        await outcomes(original, { children: 1, accepted: 0, calls: 0 });
    });

    it("retains an unattempted scheduled receipt through a valid target-status transition and ordinary client edit", async () => {
        const f = await fixture();
        const doc = await makeContract(f.client.id);
        await syncGeneration(doc, "signed", true);
        await db.raw.client.update({ where: { id: f.client.id }, data: { serviceStatus: "pre_booking" } });
        await db.raw.message_trigger_rule.update({ where: { id: f.rule.id }, data: { targetClientStatus: "active" } });
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        const prior = await getOriginal(f.rule.id);
        await f.clients.confirmBooking(branchId, f.client.id);
        await f.clients.update(branchId, f.client.id, { name: "QA-예약 확인 고객" });
        expect(await getOriginal(f.rule.id)).toMatchObject({ id: prior.id, status: "pending", scheduledFor: originalDue, firstBlockedAt: null });
        jest.setSystemTime(originalDue);
        await f.trigger.dispatchDueJobs();
        expect(await getOriginal(f.rule.id)).toMatchObject({ id: prior.id, status: "sent", originalJobId: null });
        expect(sendSms).toHaveBeenCalledTimes(1);
    });

    it("lets a fresh service and a non-receipt routine materialize beside a protected receipt", async () => {
        const f = await fixture();
        const doc = await makeContract(f.client.id);
        await syncGeneration(doc, "unsigned", false);
        const canceled = await firstAttempt(f);
        const info = await createMessageTriggerRule(db.raw, tracker, { branchId, eventType: "SERVICE_END",
            offsetType: "SAME_DAY", sendTime: "10:00", templateKey: "INFO", isActive: true });
        await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
        const infoJob = await getOriginal(info.id);
        await db.raw.message_trigger_job.update({ where: { id: infoJob.id }, data: {
            status: "canceled", canceledAt: new Date(), cancelReason: "분류하지 않은 과거 사유",
        } });
        advance(originalDue, 300);
        await f.clients.update(branchId, f.client.id, { name: "QA-고객 수정" });
        expect(await getOriginal(info.id)).toMatchObject({ id: infoJob.id, status: "pending" });
        const another = await createClient(db.raw, tracker, { branchId, voucherClient: true, birthday: "19940510",
            smsAutomationEnabled: true, startDate: new Date("2026-11-14"), endDate: new Date("2026-11-25") });
        await syncGeneration(await makeContract(another.id), "signed", true);
        await f.trigger.syncClientRulesForClient(branchId, another.id, false);
        const fresh = await db.raw.message_trigger_job.findFirstOrThrow({ where: { branchId, ruleId: f.rule.id, clientId: another.id } });
        expect(fresh).toMatchObject({ status: "pending", originalJobId: null, firstBlockedAt: null });
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: canceled.id } }))
            .toMatchObject({ status: "canceled", canceledAt: canceled.canceledAt, scheduledFor: originalDue });
        jest.setSystemTime(fresh.scheduledFor);
        await f.trigger.dispatchPendingJobNow(fresh.id, { expectedBranchId: branchId });
        expect(sendSms).toHaveBeenCalledTimes(1);
    });

    it.each(["ordinary", "recovered"] as const)("suppresses the %s worker after another auto accepted the same occurrence", async mode => {
        let f: Awaited<ReturnType<typeof fixture>>;
        let selected: message_trigger_job;
        if (mode === "recovered") {
            const recovered = await admittedChild();
            f = recovered.f;
            selected = recovered.child;
        } else {
            f = await fixture();
            const doc = await makeContract(f.client.id);
            await syncGeneration(doc, "signed", true);
            await f.trigger.syncClientRulesForClient(branchId, f.client.id, false);
            jest.setSystemTime(originalDue);
            selected = await getOriginal(f.rule.id);
        }
        const alternate = await db.raw.message_trigger_job.create({ data: { branchId,
            ruleId: f.rule.id, clientId: f.client.id, scheduledFor: selected.scheduledFor, status: "sent",
            templateKey: "SERVICE_END_NOTICE", recipientType: "CLIENT", dedupeKey: randomUUID(), recipientPhone: f.client.phone } });
        const draft = await createMessageLog(db.raw, tracker, { branchId, clientId: f.client.id, triggerJobId: alternate.id,
            receiver: f.client.phone!, templateKey: "service_end_notice_sms", providerAcceptanceState: "prepared",
            providerAcceptanceKey: randomUUID(), providerAcceptanceFingerprint: randomUUID() });
        const attempt = await f.acceptance.beginProviderCall(MessageLogMapper.toDomain(draft));
        await sendSms({ receiver: f.client.phone! });
        attempt.recordProviderResult({ accepted: true, providerMessageId: String(draft.id) });
        await f.acceptance.persist(attempt);
        await f.trigger.dispatchPendingJobNow(selected.id, { expectedBranchId: branchId });
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: selected.id } }))
            .toMatchObject({ status: "canceled", cancelReason: "OCCURRENCE_ALREADY_ACCEPTED" });
        expect(sendSms).toHaveBeenCalledTimes(1);
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, slot: { not: null }, state: "accepted" } })).toBe(1);
    });

    it("upgrades populated record-link rows, verifies both CHECK arms and replays occurrence RLS", async () => {
        const url = new URL(process.env["DATABASE_URL"]!); // Guarded by createIntegrityPrisma in beforeAll.
        const databaseName = `receipt_upgrade_throwaway_${randomUUID().replaceAll("-", "")}`;
        const command = (database: URL, args: string[], input?: string) => spawnSync(
            "psql", ["-X", "-v", "ON_ERROR_STOP=1", "-q", database.href, ...args],
            { input, encoding: "utf8" },
        );
        const succeeded = (result: ReturnType<typeof command>) => {
            if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "psql failed");
        };
        succeeded(command(url, ["-c", `CREATE DATABASE ${databaseName}`]));
        const upgradeUrl = new URL(url);
        upgradeUrl.pathname = "/" + databaseName;
        const upgrade = new PrismaClient({ datasourceUrl: upgradeUrl.href });
        const oldName = "20261124000000_add_record_link_job_recovery";
        const newName = "20261124010000_add_receipt_job_recovery";
        const occurrenceName = "20261123010000_add_message_occurrence_claim";
        const migration = (name: string) => resolve("prisma/migrations", name, "migration.sql");
        const verifier = (name: string) => resolve("prisma/scripts", `verify-${name}.sql`);
        const apply = (...paths: string[]) => succeeded(command(upgradeUrl, paths.flatMap(path => ["-f", path])));
        const newVerifier = verifier("receipt-job-recovery");
        const oldVerifier = verifier("record-link-job-recovery");
        const checkName = "ck_message_trigger_job_record_link_recovery";
        const upgradeTracker = new RowTracker();

        try {
            const prefix = readdirSync(resolve("prisma/migrations"), { withFileTypes: true })
                .filter(entry => entry.isDirectory() && entry.name <= oldName)
                .map(entry => entry.name).sort();
            expect(prefix.at(-1)).toBe(oldName);
            apply(...prefix.map(migration), oldVerifier);

            const branch = await createBranch(upgrade, upgradeTracker);
            const client = await createClient(upgrade, upgradeTracker, { branchId: branch.id });
            const receiptRule = await createMessageTriggerRule(upgrade, upgradeTracker, { branchId: branch.id,
                templateKey: "SERVICE_END_NOTICE", recipientType: "CLIENT", eventType: "SERVICE_END" });
            const recordRule = await upgrade.message_trigger_rule.upsert({ where: { id: "system:service_record_link" }, update: {},
                create: { id: "system:service_record_link", name: "기록지", eventType: "SERVICE_START", offsetType: "SAME_DAY",
                    templateKey: "SERVICE_RECORD_LINK", recipientType: "PRIMARY_EMPLOYEE" } });
            const ordinary = { branchId: branch.id, ruleId: receiptRule.id, clientId: client.id,
                recipientType: "CLIENT", templateKey: "SERVICE_END_NOTICE", scheduledFor: originalDue };
            const record = { branchId: branch.id, ruleId: recordRule.id, templateKey: "SERVICE_RECORD_LINK",
                recipientType: "PRIMARY_EMPLOYEE", scheduledFor: originalDue, recoveryReason: "record_link_pre_booking", recoveryEpoch: beforeDue };
            const receipt = { ...ordinary, recoveryReason: "live_unsigned_contract", recoveryEpoch: beforeDue };
            const create = (data: Prisma.message_trigger_jobUncheckedCreateInput) => upgrade.message_trigger_job.create({ data });
            const original = await create({ ...ordinary, dedupeKey: "ordinary" });
            const recordParent = await create({ ...record, dedupeKey: "record-parent", status: "canceled",
                firstBlockedAt: originalDue, recoveryState: "admitted", recoveryTransitionStatus: "active" });
            const recordChild = await create({ ...record, originalJobId: recordParent.id, dedupeKey: `record-retry:${recordParent.id}` });
            const receiptParentData = { ...receipt, id: randomUUID(), dedupeKey: "receipt-parent", status: "canceled",
                canceledAt: originalDue, firstBlockedAt: originalDue, recoveryState: "admitted" };

            await upgrade.$transaction(async tx => {
                await refusesSql(tx, Prisma.sql`INSERT INTO message_trigger_job (id, branch_id, client_id, rule_id, recipient_type,
                    template_key, dedupe_key, status, scheduled_for, updated_at, canceled_at, first_blocked_at, recovery_reason,
                    recovery_epoch, recovery_state) VALUES (${receiptParentData.id}, ${branch.id}::uuid, ${client.id},
                    ${receiptRule.id}, 'CLIENT', 'SERVICE_END_NOTICE', 'receipt-parent', 'canceled', ${originalDue},
                    ${originalDue}, ${originalDue}, ${originalDue}, 'live_unsigned_contract', ${beforeDue}, 'admitted')`,
                    "23514", checkName);
            });
            const rows = () => upgrade.message_trigger_job.findMany({ where: { branchId: branch.id }, orderBy: { id: "asc" } });
            const before = await rows();
            expect(before).toHaveLength(3);
            expect(before).toEqual(expect.arrayContaining([original, recordParent, recordChild]));

            apply(migration(newName), newVerifier);
            expect(await rows()).toEqual(before);
            const receiptParent = await create(receiptParentData);
            const receiptChild = await create({ ...receipt, originalJobId: receiptParent.id, dedupeKey: `receipt-retry:${receiptParent.id}` });
            const upgraded = await rows();
            expect(upgraded).toHaveLength(5);
            apply(migration(oldName), oldVerifier, migration(newName), newVerifier);
            expect(await rows()).toEqual(upgraded);
            const structure = () => upgrade.$queryRaw<Array<{ conname: string; convalidated: boolean; definition: string }>>(Prisma.sql`
                SELECT conname, convalidated, pg_get_constraintdef(oid, false) AS definition
                FROM pg_constraint WHERE conrelid = 'public.message_trigger_job'::regclass
                  AND conname IN (${checkName}, 'message_trigger_job_original_job_id_fkey')`);
            expect(await structure()).toEqual(expect.arrayContaining([
                expect.objectContaining({ conname: checkName, convalidated: true }),
                { conname: "message_trigger_job_original_job_id_fkey", convalidated: true,
                    definition: "FOREIGN KEY (original_job_id) REFERENCES message_trigger_job(id)" },
            ]));
            expect(await upgrade.$queryRaw`SELECT indisunique, indisvalid, pg_get_indexdef(indexrelid, 1, false) AS column
                FROM pg_index WHERE indexrelid = 'public.uq_message_trigger_job_original_job_id'::regclass
                AND indrelid = 'public.message_trigger_job'::regclass AND indnkeyatts = 1`)
                .toEqual([{ indisunique: true, indisvalid: true, column: "original_job_id" }]);

            await upgrade.$transaction(async tx => {
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET first_blocked_at = now() WHERE id = ${receiptChild.id}`, "23514", checkName);
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET recovery_epoch = NULL WHERE id = ${receiptChild.id}`, "23514", checkName);
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET status = 'pending' WHERE id = ${receiptParent.id}`, "23514", checkName);
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET recovery_reason = 'record_link_pre_booking' WHERE id = ${receiptChild.id}`, "23514", checkName);
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET recovery_transition_status = NULL WHERE id = ${recordParent.id}`, "23514", checkName);
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET first_blocked_at = now() WHERE id = ${recordChild.id}`, "23514", checkName);
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET dedupe_key = 'receipt-retry:ordinary' WHERE id = ${original.id}`, "23514", checkName);
                // A second child with a distinct, CHECK-valid key isolates the original-job unique index.
                await refusesSql(tx, Prisma.sql`INSERT INTO message_trigger_job (branch_id, rule_id, recipient_type, template_key,
                    scheduled_for, updated_at, original_job_id, recovery_epoch, recovery_reason, dedupe_key)
                    VALUES (${branch.id}::uuid, ${recordRule.id}, 'PRIMARY_EMPLOYEE', 'SERVICE_RECORD_LINK', now(), now(),
                        ${receiptParent.id}, ${beforeDue}, 'record_link_pre_booking', ${`record-retry:${receiptParent.id}`})`,
                    "23505", "Key (original_job_id)=");
                const missing = randomUUID();
                await refusesSql(tx, Prisma.sql`UPDATE message_trigger_job SET original_job_id = ${missing}, dedupe_key = ${`receipt-retry:${missing}`}
                    WHERE id = ${receiptChild.id}`, "23503", "message_trigger_job_original_job_id_fkey");
            });

            const approvedPatch = readFileSync(migration(newName), "utf8");
            for (const predicate of [" AND recipient_type = 'PRIMARY_EMPLOYEE'", "recipient_type = 'CLIENT' AND "]) {
                const mutant = approvedPatch.replace(predicate, "");
                expect(mutant).not.toBe(approvedPatch);
                succeeded(command(upgradeUrl, ["-f", "-"], mutant));
                expect(await structure()).toEqual(expect.arrayContaining([expect.objectContaining({ conname: checkName, convalidated: true })]));
                const result = command(upgradeUrl, ["-f", newVerifier]);
                expect(result.status).toBe(3);
                expect(result.stderr).toContain("ERROR:  Receipt recovery CHECK definition mismatch");
                apply(migration(newName), newVerifier);
            }
            expect(await rows()).toEqual(upgraded);

            const occurrenceVerifier = verifier("message-occurrence-claim");
            apply(migration(occurrenceName), occurrenceVerifier, migration(occurrenceName), occurrenceVerifier);
            const acceptedLog = await createMessageLog(upgrade, upgradeTracker, { branchId: branch.id });
            const otherLog = await createMessageLog(upgrade, upgradeTracker, { branchId: branch.id });
            const claim = { branchId: branch.id, occurrenceKey: "a".repeat(64), templateKey: "SERVICE_END_NOTICE",
                lifecycleId: client.id, recipientKind: "client", recipientId: client.id };
            await upgrade.message_occurrence_claim.create({ data: claim });
            await upgrade.message_occurrence_manual_attempt.create({ data: { branchId: branch.id,
                occurrenceKey: claim.occurrenceKey, logId: acceptedLog.id, state: "accepted" } });
            await upgrade.$transaction(async tx => {
                // The role and its grants are transactional and removed when this savepoint rolls back.
                const reader = `occurrence_reader_${randomUUID().replaceAll("-", "")}`;
                await tx.$executeRaw`SAVEPOINT ledger_role`;
                try {
                    await tx.$executeRawUnsafe(`CREATE ROLE ${reader} NOSUPERUSER NOBYPASSRLS`);
                    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${reader}`);
                    await tx.$executeRawUnsafe(`GRANT SELECT, INSERT ON message_occurrence_claim, message_occurrence_manual_attempt TO ${reader}`);
                    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${reader}`);
                    expect(await tx.message_occurrence_claim.count()).toBe(0);
                    expect(await tx.message_occurrence_manual_attempt.count()).toBe(0);
                    await refusesSql(tx, Prisma.sql`INSERT INTO message_occurrence_claim
                        (branch_id, occurrence_key, template_key, lifecycle_id, recipient_kind, recipient_id)
                        VALUES (${branch.id}::uuid, ${"b".repeat(64)}, 'SERVICE_END_NOTICE', ${client.id}, 'client', ${client.id})`,
                        "42501", "row-level security policy");
                    await refusesSql(tx, Prisma.sql`INSERT INTO message_occurrence_manual_attempt (branch_id, occurrence_key, log_id, state)
                        VALUES (${branch.id}::uuid, ${claim.occurrenceKey}, ${otherLog.id}, 'accepted')`, "42501", "row-level security policy");
                } finally {
                    await tx.$executeRaw`ROLLBACK TO SAVEPOINT ledger_role`;
                }
                expect(await tx.message_occurrence_claim.count({ where: { branchId: branch.id } })).toBe(1);
                expect(await tx.message_occurrence_manual_attempt.count({ where: { branchId: branch.id } })).toBe(1);
            });
        } finally {
            await upgrade.$disconnect();
            succeeded(command(url, ["-c", `DROP DATABASE ${databaseName}`]));
        }
    }, 60_000);

    async function refusesSql(tx: Prisma.TransactionClient, statement: Prisma.Sql, code: string, message: string) {
        await tx.$executeRaw`SAVEPOINT invalid_statement`;
        try {
            await expect(tx.$executeRaw(statement)).rejects.toMatchObject({ meta: { code, message: expect.stringContaining(message) } });
        } finally {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_statement`;
            await tx.$executeRaw`RELEASE SAVEPOINT invalid_statement`;
        }
    }
});
