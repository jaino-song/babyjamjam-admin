import { SmsRetryService } from "application/services/sms-retry.service";
import { protectedReceiptOriginalSql } from "infrastructure/database/repositories/receipt-job-recovery.repository";
import { AGENT_AUTOMATION_JOB_SEAL_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { AUTOMATION_CONSENT_CANCEL_REASON } from "domain/constants/message-automation-policy";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import { manualTemplateVariables } from "infrastructure/database/repositories/message-occurrence-ledger";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { ConfigService } from "@nestjs/config";
import { Prisma, type message_trigger_job } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { AligoDefaultSenderPolicyService } from "application/services/aligo-default-sender-policy.service";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import { ClientAutomationSourceReader } from "application/services/client-automation-source.reader";
import { ClientService } from "application/services/client.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { MessageQuietHoursService } from "application/services/message-quiet-hours.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
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
import { SYSTEM_TEMPLATE_REGISTRY, type SystemTemplateKey } from "domain/constants/system-template-registry";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { CanceledAutomationRetryRepository } from "infrastructure/database/repositories/canceled-automation-retry.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { mirrorDetail } from "../contracts/contracts-fixture";
import { createBranch, createClient, createEformsignDoc, createMessageLog, createMessageTriggerRule } from "../helpers/factories";
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
    const sendSms = jest.fn(async (request: { receiver: string }) => ({
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
        const settings = new SystemSettingService(new GetSettingUsecase(settingRepo), new UpdateSettingUsecase(settingRepo));
        const templates = { getByKeyForBranch: async (_branchId: string, key: SystemTemplateKey) => ({
            id: key, content: SYSTEM_TEMPLATE_REGISTRY[key].defaultContent, updatedAt: new Date(0),
        }) };
        const config = new ConfigService({ RECEIPT_LINK_HASH_SALT: "synthetic-private-db-test",
            MOBILE_RECEIPT_BASE_URL: "https://example.test", CLIENT_TOMBSTONE_DELETE_ENABLED: "true" });
        const clientRepo = new SbClientRepository(database, config);
        const docRepo = new SbEformsignDocRepository(database);
        const mirror = new SbEformsignDocumentMirrorRepository(database);
        const tokens = new ReceiptLinkTokenService(new SbReceiptLinkTokenRepository(database), config);
        const storage = { upload: jest.fn(async () => {}), createSignedUrl: jest.fn(async () => "https://example.test/file") };
        const vendor = { syncDocument: jest.fn(async () => { throw new Error("synthetic vendor read failure"); }) };
        const issue = new ReceiptLinkIssueService(clientRepo, docRepo, mirror, vendor as never, config,
            { renderPageToPng: async () => Buffer.from("synthetic PNG") } as never, tokens, storage as never);
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enricher = new ReceiptLinkDeliveryEnricher(registry, issue, tokens, storage as never);
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
        return { retry, trigger, clients, delivery, issue, vendor, mirror, acceptance, lock, docRepo, transport };
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

    it.each(receiptReasons)("captures %s and recovers once after committed evidence", async reason => {
        const f = await fixture(reason === "missing_birthday" ? null : undefined);
        let document = reason === "missing_current_contract" ? null : await makeContract(f.client.id);
        if (document) await syncGeneration(document, reason === "live_unsigned_contract" ? "unsigned" : "signed", reason === "missing_birthday");
        await f.retry.update(branchId, f.rule.id, true);
        const original = await firstAttempt(f);
        expect(original).toMatchObject({ status: "canceled", recoveryReason: reason, recoveryState: "eligible", firstBlockedAt: originalDue });
        expect(sendSms).not.toHaveBeenCalled();
        jest.setSystemTime(nineDaysLater);
        if (reason === "missing_birthday") {
            await f.clients.update(branchId, f.client.id, { birthday: "19940510" });
        } else {
            document ??= await makeContract(f.client.id);
            await syncGeneration(document, "signed", true);
        }
        const secondWorker = worker(independent);
        await Promise.all([
            f.trigger.sweepReceiptRecovery(), secondWorker.trigger.sweepReceiptRecovery(),
            secondWorker.trigger.wakeReceiptRecovery(branchId, f.client.id),
        ]);
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
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "unsigned", false);
        await f.retry.update(branchId, f.rule.id, true);
        const original = await firstAttempt(f);
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
            if (pause) await pause.prepared;
            const mutation = editor.trigger.updateRuleApprovedTarget(branchId, f.rule.id, { sendTime: "16:00" }, version, snapshot);
            if (pause) {
                await expect(mutation).rejects.toThrow();
                expect(await db.raw.message_trigger_rule.findUnique({ where: { id: rule.id } })).toMatchObject({ sendTime: "10:00" });
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

    it.each(["missing mirror", "unknown status", "void", "revoke", "replacement", "purge", "wrong tenant"] as const)(
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
            } else if (condition === "wrong tenant") {
                const foreign = await createBranch(db.raw, tracker);
                await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { branchId: foreign.id } });
            }
            await f.retry.update(branchId, f.rule.id, true);
            const original = await firstAttempt(f);
            advance(originalDue, 65);
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
            await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { voidedAt: null, permanentPurgeRequestedAt: null, branchId } });
            await syncGeneration(document, "signed", true);
            advance(originalDue, 120);
            await f.trigger.wakeReceiptRecovery(branchId, f.client.id);
            await f.trigger.dispatchDueJobs();
            await outcomes(original, { children: 0, accepted: 0, calls: 0 });
        },
    );

    it.each(["partial", "failed", "unreadable"] as const)("never enrolls a %s PDF result", async state => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "signed", false, state === "unreadable" ? "syncing" : state);
        if (state === "unreadable") jest.spyOn(f.mirror, "findFile").mockRejectedValueOnce(new Error("local read failed"));
        if (state === "partial") await db.raw.eformsign_doc.update({ where: { id: document.id }, data: { syncError: "Files not ready: document" } });
        await f.retry.update(branchId, f.rule.id, true);
        const original = await firstAttempt(f);
        expect(original).toMatchObject({ recoveryState: "ineligible_terminal", recoveryEpoch: null });
        jest.setSystemTime(nineDaysLater);
        await syncGeneration(document, "signed", true);
        await f.trigger.dispatchDueJobs();
        await outcomes(original, { children: 0, accepted: 0, calls: 0 });
    });

    it("uses a committed syncing generation seen while the real mirror waits for its PDF", async () => {
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await f.retry.update(branchId, f.rule.id, true);
        const detail = mirrorDetail({ documentId: document.documentId, statusType: "070", updatedDate: beforeDue });
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
        const syncing = mirrorService.syncDocument(document.documentId, { branchId, source: "worker" }, { skipClientReconciliation: true });
        let original: message_trigger_job;
        try {
            await Promise.race([downloading, syncing.then(() => { throw new Error("Mirror completed before its document download"); })]);
            expect(await f.mirror.findState(document.documentId)).toMatchObject({
                syncStatus: "syncing", syncError: null, permanentPurgeRequestedAt: null,
                detailSourceUpdatedDate: beforeDue, detailSyncedAt: beforeDue,
            });
            expect(await f.mirror.findFile(document.documentId, "document")).toBeNull();
            original = await firstAttempt(f);
            expect(f.vendor.syncDocument).toHaveBeenCalledTimes(1);
            expect(original).toMatchObject({ recoveryReason: "current_contract_pdf_pending", recoveryState: "eligible" });
            expect(await f.mirror.findFile(document.documentId, "document")).toBeNull();
        } finally {
            finishDownload();
            await syncing;
        }
        await f.trigger.dispatchPendingJobNow((await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original.id } })).id,
            { expectedBranchId: branchId });
        await outcomes(original, { children: 1, accepted: 1, calls: 1 });
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

    it("replays both patches and checks disjoint parent, child and ordinary constraints", async () => {
        const paths = [
            "migrations/20261124000000_add_record_link_job_recovery/migration.sql",
            "scripts/verify-record-link-job-recovery.sql",
            "migrations/20261124010000_add_receipt_job_recovery/migration.sql",
            "scripts/verify-receipt-job-recovery.sql",
        ];
        const runPatches = () => {
            for (const path of paths) {
                execFileSync("psql", ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--quiet", process.env["DATABASE_URL"]!,
                    "--file", resolve("prisma", path)], { stdio: "pipe" });
            }
        };
        runPatches();
        const f = await fixture();
        const document = await makeContract(f.client.id);
        await syncGeneration(document, "unsigned", false);
        await f.retry.update(branchId, f.rule.id, true);
        const original = await firstAttempt(f);
        await syncGeneration(document, "signed", true);
        await f.trigger.wakeReceiptRecovery(branchId, f.client.id);
        const child = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original.id } });

        const recordRule = "system:service_record_link";
        await db.raw.message_trigger_rule.upsert({ where: { id: recordRule }, update: {},
            create: { id: recordRule, name: "기록지", eventType: "SERVICE_START", offsetType: "SAME_DAY",
                templateKey: "SERVICE_RECORD_LINK", recipientType: "PRIMARY_EMPLOYEE" } });
        const recordIdentity = { branchId, ruleId: recordRule, templateKey: "SERVICE_RECORD_LINK",
            recipientType: "PRIMARY_EMPLOYEE", scheduledFor: originalDue, recoveryReason: "record_link_pre_booking",
            recoveryEpoch: original.recoveryEpoch };
        const recordParent = await db.raw.message_trigger_job.create({ data: { ...recordIdentity, dedupeKey: randomUUID(),
            status: "canceled", firstBlockedAt: originalDue, recoveryState: "admitted", recoveryTransitionStatus: "active" } });
        const recordChild = await db.raw.message_trigger_job.create({ data: { ...recordIdentity,
            originalJobId: recordParent.id, dedupeKey: `record-retry:${recordParent.id}` } });
        runPatches();
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: original.id } }))
            .toMatchObject({ status: "canceled", scheduledFor: original.scheduledFor, canceledAt: original.canceledAt });
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: recordParent.id } })).toEqual(recordParent);
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: recordChild.id } })).toEqual(recordChild);
        expect(await db.raw.message_trigger_job.findUnique({ where: { originalJobId: original.id } })).toEqual(child);
        await db.raw.$transaction(async tx => {
            async function refuses(statement: Prisma.Sql, code: string) {
                await tx.$executeRaw`SAVEPOINT malformed`;
                try {
                    await expect(tx.$executeRaw(statement)).rejects.toMatchObject({ meta: { code } });
                } finally {
                    await tx.$executeRaw`ROLLBACK TO SAVEPOINT malformed`;
                    await tx.$executeRaw`RELEASE SAVEPOINT malformed`;
                }
            }
            await refuses(Prisma.sql`UPDATE message_trigger_job SET first_blocked_at = now() WHERE id = ${child.id}`, "23514");
            await refuses(Prisma.sql`UPDATE message_trigger_job SET recovery_epoch = NULL WHERE id = ${child.id}`, "23514");
            await refuses(Prisma.sql`UPDATE message_trigger_job SET scheduled_for = now(), status = 'pending' WHERE id = ${original.id}`, "23514");
            await refuses(Prisma.sql`UPDATE message_trigger_job SET recovery_reason = 'record_link_pre_booking' WHERE id = ${child.id}`, "23514");
            await refuses(Prisma.sql`UPDATE message_trigger_job SET recovery_transition_status = NULL WHERE id = ${recordParent.id}`, "23514");
            await refuses(Prisma.sql`UPDATE message_trigger_job SET first_blocked_at = now() WHERE id = ${recordChild.id}`, "23514");
            await refuses(Prisma.sql`INSERT INTO message_trigger_job (branch_id, rule_id, recipient_type, template_key,
                scheduled_for, updated_at, original_job_id, recovery_epoch, recovery_reason, dedupe_key)
                VALUES (${branchId}::uuid, ${recordRule}, 'PRIMARY_EMPLOYEE', 'SERVICE_RECORD_LINK', now(), now(),
                    ${original.id}, ${original.recoveryEpoch}, 'record_link_pre_booking', ${`record-retry:${original.id}`})`, "23505");
            const missing = randomUUID();
            await refuses(Prisma.sql`UPDATE message_trigger_job SET original_job_id = ${missing}, dedupe_key = ${`receipt-retry:${missing}`}
                WHERE id = ${child.id}`, "23503");
        });
    });
});
