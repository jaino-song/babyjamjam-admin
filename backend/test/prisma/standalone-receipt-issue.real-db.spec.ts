import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { client, Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { Response } from "express";
import { captureBackendError } from "infrastructure/observability/service-record-sentry";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageQuietHoursService } from "application/services/message-quiet-hours.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { SmsTriggerPayloadEnricherRegistry } from "application/services/sms-trigger-payload-enricher.registry";
import { StandaloneReceiptIssueService } from "application/services/standalone-receipt-issue.service";
import { StandaloneReceiptPreparationService } from "application/services/standalone-receipt-preparation.service";
import { MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import { MessageTriggerJobEntity, type MessageTriggerJobPayload } from "domain/entities/message-trigger-job.entity";
import { STANDALONE_RECEIPT_HISTORY_PLACEHOLDER } from "domain/entities/standalone-receipt-request";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { OCCURRENCE_ALREADY_ACCEPTED } from "domain/entities/message-occurrence";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { FileStorageObjectNotFoundError } from "domain/ports/file-storage.port";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { StandaloneReceiptRenderer } from "infrastructure/pdf/standalone-receipt-renderer";
import { StandaloneReceiptTemplateLoader, StandaloneReceiptTemplateUnavailableError } from "infrastructure/pdf/standalone-receipt-template.loader";
import { createBranch, createClient, createEformsignDoc, createMessageTriggerRule } from "../integrity/helpers/factories";
import { closeIntegrityPrisma, createIntegrityPrisma, type IntegrityPrisma } from "../integrity/helpers/real-db";
import { RowTracker } from "../integrity/helpers/tracker";

jest.mock("infrastructure/observability/service-record-sentry", () => ({
    ...jest.requireActual("infrastructure/observability/service-record-sentry"),
    captureBackendError: jest.fn(),
}));

const describeReal = process.env["STANDALONE_RECEIPT_REAL_DB"] === "1" ? describe : describe.skip;
const JAN_1 = new Date("2026-01-01T00:00:00Z");
const JAN_31 = new Date("2026-01-31T00:00:00Z");
const OLD_DATE = new Date("2025-12-31T00:00:00Z");
const NEW_DATE = "2026-01-02";
const BIRTHDAY = "19940203";
const PHONE = "01000004121";
const issuer = randomUUID();
const syntheticTemplate = readFileSync(join(__dirname, "../fixtures/standalone-receipt-synthetic.png"));
const verifier = readFileSync(join(__dirname, "../../prisma/scripts/verify-receipt-link-patches.sql"), "utf8");

function barrier(participants: number) {
    let arrived = 0;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    return async () => {
        if (++arrived === participants) release();
        await ready;
    };
}

describeReal("standalone receipt issuance on PostgreSQL", () => {
    let db: IntegrityPrisma;
    let tracker: RowTracker;
    let a: string;
    let b: string;
    let x: client;
    let y: client;
    let foreign: client;
    let fixture: ReturnType<typeof worker>;
    let diagnosticLogs: jest.SpyInstance[];

    function diagnostics(): string {
        const telemetry = jest.mocked(captureBackendError).mock.calls.map(([error, context]) => ({
            error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
            context,
        }));
        return JSON.stringify([diagnosticLogs.flatMap(log => log.mock.calls), telemetry]);
    }

    function worker(prisma: PrismaClient = db.service) {
        const database = prisma as IntegrityPrisma["service"];
        const objects = new Map<string, Buffer>();
        const storage = {
            download: jest.fn(async (path: string) => {
                const object = objects.get(path);
                if (!object) throw new FileStorageObjectNotFoundError(path, "download");
                return object;
            }),
            createPrivateObject: jest.fn(async (bytes: Buffer, path: string) => {
                if (objects.has(path)) throw new Error("Synthetic create-only conflict");
                objects.set(path, Buffer.from(bytes));
            }),
        };
        const loader = new StandaloneReceiptTemplateLoader(storage);
        const load = jest.spyOn(loader, "load").mockResolvedValue(syntheticTemplate);
        const renderer = new StandaloneReceiptRenderer();
        const render = jest.spyOn(renderer, "render");
        const approval = new MessageSenderApprovalService(database);
        const tokens = new SbReceiptLinkTokenRepository(database);
        const tokenService = new ReceiptLinkTokenService(tokens, new ConfigService({ RECEIPT_LINK_HASH_SALT: "synthetic-test-receipt-salt" }));
        const rules = new SbMessageTriggerRuleRepository(database);
        const jobs = new SbMessageTriggerJobRepository(database);
        const logs = new SbMessageLogRepository(database);
        const acceptance = new SmsProviderAcceptanceService(logs);
        const preparation = new StandaloneReceiptPreparationService(database, tokens, tokenService, loader, renderer, storage as never);
        const issue = new StandaloneReceiptIssueService(database, approval, loader, tokenService, rules);
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const contracts = {
            issue: jest.fn(), assertDocumentSyncReady: jest.fn(),
            buildReceiptUrl: (bearer: string) => `https://receipts.invalid/receipt/${bearer}`,
        };
        new ReceiptLinkDeliveryEnricher(registry, contracts as never, tokenService, storage as never, preparation).onModuleInit();
        const configuration = defaultMessageAutomationPolicy();
        const settings = {
            getMessageAutomationPolicyConfig: async () => ({ configuration, version: "fixture" }),
            getMessageSettingsPolicyEnabled: async () => true,
        };
        const templates = { getByKeyForBranch: async () => ({ id: "fixture", content: "{{name}}\n{{receiptUrl}}", updatedAt: JAN_1 }) };
        const lock = new MessageAutomationBranchLockService(database);
        const activation = new MessageAutomationActivationService(database, lock, {} as never);
        const gate = new AgentAutomationDeliveryGateService(database, lock, { checkAutomaticJob: async () => ({ status: "legacy" }) } as never);
        const quiet = new MessageQuietHoursService(settings as never, logs, lock);
        const provider = {
            sendSms: jest.fn(async (request: { receiver: string; message: string }) => ({
                request,
                response: { result_code: 1, success_cnt: 1, error_cnt: 0, msg_id: 123, message: "accepted" },
            })),
        };
        const buildDelivery = () => new SmsTriggerDeliveryService(provider as never, templates as never, logs, acceptance,
            registry, gate, rules, settings as never, undefined, quiet, jobs);
        const delivery = buildDelivery();
        const core = new MessageTriggerService(database, new MessageTriggerDeliveryService(delivery), approval,
            rules, jobs, logs, templates as never, {} as never, settings as never, undefined, activation, lock,
            undefined, gate, undefined, new SmsAutomationSafeguardService(database, activation));
        const retry = () => new SmsRetryService(logs, provider as never, approval, acceptance, activation, undefined,
            buildDelivery(), jobs, undefined, settings as never, quiet);
        return {
            issue, preparation, contracts, storage, objects, load, render, provider, jobs, logs, gate, tokenService,
            retry, core, publicLinks: new ReceiptLinkController(tokenService, storage as never), dispatch: (jobId: string) => core.dispatchPendingJobNow(jobId, { expectedBranchId: a }),
        };
    }

    const input = (requestId = randomUUID(), clientId = x.id, copaymentReceivedDate = NEW_DATE, branchId = a) =>
        ({ branchId, userId: issuer, clientId, copaymentReceivedDate, requestId });
    const rows = () => db.raw.message_trigger_job.findMany({ where: { branchId: { in: [a, b] }, standaloneRequestId: { not: null } } });
    const tokens = () => db.raw.receipt_link_token.findMany({ where: { branchId: { in: [a, b] }, kind: "standalone" } });
    const date = async (id = x.id) => (await db.raw.client.findUniqueOrThrow({ where: { id } })).copaymentReceivedDate;
    const row = (id: string) => db.raw.message_trigger_job.findUniqueOrThrow({ where: { id } });
    const job = (id: string) => fixture.jobs.findByIdInBranch(a, id).then(value => value!);

    beforeAll(async () => { db = await createIntegrityPrisma(); });
    afterAll(async () => { if (db) await closeIntegrityPrisma(db); });
    beforeEach(async () => {
        jest.useFakeTimers({ now: JAN_1, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
        jest.mocked(captureBackendError).mockClear();
        diagnosticLogs = [
            jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined),
            jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined),
            jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined),
            jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined),
        ];
        tracker = new RowTracker();
        a = (await createBranch(db.raw, tracker, { name: "QA-지점 A", smsSenderApprovalStatus: "approved" })).id;
        b = (await createBranch(db.raw, tracker, { name: "QA-지점 B", smsSenderApprovalStatus: "approved" })).id;
        const clientData = {
            name: "QA-가", birthday: BIRTHDAY, startDate: new Date("2025-12-01"), endDate: OLD_DATE,
            fullPrice: "100,000원", grant: "70000", actualPrice: "30000", serviceStatus: "completed",
            copaymentReceivedDate: OLD_DATE, smsAutomationEnabled: false,
        };
        x = await createClient(db.raw, tracker, { ...clientData, branchId: a, phone: PHONE, phoneNormalized: PHONE });
        y = await createClient(db.raw, tracker, { ...clientData, branchId: a, name: "QA-나" });
        foreign = await createClient(db.raw, tracker, { ...clientData, branchId: b, name: "QA-다" });
        fixture = worker();
    });
    afterEach(async () => {
        jest.useRealTimers();
        diagnosticLogs?.forEach(log => log.mockRestore());
        if (!tracker) return;
        const where = { branchId: { in: [a, b] } };
        await db.raw.message_occurrence_manual_attempt.deleteMany({ where });
        await db.raw.message_occurrence_claim.deleteMany({ where });
        await db.raw.receipt_link_token.deleteMany({ where });
        await db.raw.message_log.deleteMany({ where });
        await db.raw.message_trigger_job.deleteMany({ where });
        await tracker.cleanup(db.raw);
    });

    it("freezes both snapshots, uses the actual renderer without a contract and sends as manual with automation off", async () => {
        const original = input();
        const first = await fixture.issue.issue(original);
        expect(first).toEqual({ jobId: expect.any(String), queued: true });
        expect(await date()).toEqual(new Date(NEW_DATE));
        expect(await tokens()).toHaveLength(0);
        expect(fixture.render).not.toHaveBeenCalled();
        expect(fixture.storage.createPrivateObject).not.toHaveBeenCalled();
        const firstRow = await row(first.jobId);
        const request = (firstRow.payload as unknown as MessageTriggerJobPayload).standaloneReceipt!;
        expect(request.receipt).toEqual({
            customerName: "QA-가", serviceStartDate: "2025-12-01", endDate: "2025-12-31", receivedDate: NEW_DATE,
            issueDate: "2026-01-01", fullPrice: 100000, grant: 70000, actualPrice: 30000,
        });
        expect(JSON.stringify(request)).not.toContain(BIRTHDAY);

        await db.raw.client.update({ where: { id: x.id }, data: { name: "QA-나", birthday: "19940304", actualPrice: "0" } });
        await createEformsignDoc(db.raw, tracker, { branchId: a, clientId: x.id, voidedAt: JAN_1 });
        const second = await fixture.issue.issue(input(randomUUID(), x.id, "2026-01-03"));
        expect(await fixture.dispatch(first.jobId)).toMatchObject({ status: "sent" });
        expect(await fixture.dispatch(second.jobId)).toMatchObject({ status: "sent" });
        expect(fixture.render.mock.calls.map(([, frozen]) => frozen)).toEqual([
            request.receipt, { ...request.receipt, customerName: "QA-나", receivedDate: "2026-01-03", actualPrice: 0 },
        ]);
        expect(fixture.contracts.issue).not.toHaveBeenCalled();
        expect(fixture.contracts.assertDocumentSyncReady).not.toHaveBeenCalled();
        expect(fixture.provider.sendSms).toHaveBeenCalledTimes(2);
        const links = fixture.provider.sendSms.mock.calls.map(([send]) => send.message.split("\n")[1]!);
        expect(new Set(links).size).toBe(2);
        const firstBearer = new URL(links[0]!).pathname.split("/").at(-1)!;
        expect(await fixture.tokenService.verifyBirthday(firstBearer, "19940304", JAN_1)).toMatchObject({ ok: false });
        const verified = await fixture.publicLinks.receiptVerify(firstBearer, { birthday: BIRTHDAY });
        expect(verified).toMatchObject({ ok: true, clientName: "QA-가", accessToken: expect.any(String) });
        expect(await fixture.publicLinks.receiptAccess(firstBearer, verified.accessToken)).toEqual({ ok: true, clientName: "QA-가" });
        const image = { set: jest.fn(), send: jest.fn() };
        await fixture.publicLinks.image(firstBearer, "1", verified.accessToken, undefined, image as unknown as Response);
        const firstToken = (await tokens()).find(token => token.jobId === first.jobId)!;
        expect(image.send).toHaveBeenCalledWith(fixture.objects.get(firstToken.storagePath));
        expect(JSON.stringify([await fixture.publicLinks.receiptStatus(firstBearer), verified, image.set.mock.calls])
            .includes("synthetic-signed-storage-url")).toBe(false);
        expect(await fixture.tokenService.getStatus(firstBearer, JAN_31)).toEqual({ ok: false, reason: "expired" });
        const logRows = await db.raw.message_log.findMany({ where: { branchId: a } });
        expect(logRows.every(log => log.providerAcceptanceState === "accepted")).toBe(true);
        expect(logRows.every(log => log.messageBody.includes(STANDALONE_RECEIPT_HISTORY_PLACEHOLDER))).toBe(true);
        const persisted = JSON.stringify([await rows(), await tokens(), logRows]);
        expect([firstBearer, links[0]!, "synthetic-signed-storage-url"].some(secret => persisted.includes(secret))).toBe(false);
        expect([firstBearer, links[0]!, PHONE, BIRTHDAY, "QA-가"].some(secret => diagnostics().includes(secret))).toBe(false);
        expect(await fixture.issue.issue(original)).toEqual(first);
        expect(await date()).toEqual(new Date("2026-01-03"));

        await db.raw.client.update({ where: { id: x.id }, data: { deletedAt: JAN_1 } });
        expect(await fixture.tokenService.getStatus(firstBearer, JAN_1)).toEqual({ ok: false, reason: "not_found" });
        await expect(fixture.issue.issue(original)).rejects.toMatchObject({ status: 404 });
    });

    it("sends a standalone link for a signed client without changing the contract token, then suppresses automatic enrollment", async () => {
        const doc = await createEformsignDoc(db.raw, tracker, { branchId: a, clientId: x.id, statusType: "050" });
        const contractPath = `receipts/${a}/${x.id}/contract-proof.png`;
        const contractBytes = Buffer.from("synthetic legacy artifact");
        fixture.objects.set(contractPath, contractBytes);
        const legacy = await fixture.tokenService.issue({
            branchId: a, clientId: x.id, eformsignDocId: doc.id, birthday: BIRTHDAY, storagePath: contractPath,
            contentSha256: createHash("sha256").update(contractBytes).digest("hex"), byteSize: contractBytes.length,
            source: "manual",
        });
        const readLegacy = () => db.raw.receipt_link_token.findUniqueOrThrow({ where: { id: legacy.id } });
        const original = await readLegacy();
        const accepted = await fixture.issue.issue(input());
        const dispatched = await fixture.dispatch(accepted.jobId);
        expect(dispatched.status).toBe("sent");
        expect(fixture.provider.sendSms.mock.calls[0]![0].message.includes(legacy.linkToken)).toBe(false);
        expect(await readLegacy()).toEqual(original);
        expect(fixture.objects.get(contractPath)).toEqual(contractBytes);
        expect(fixture.contracts.issue).not.toHaveBeenCalled();

        await db.raw.client.update({ where: { id: x.id }, data: { smsAutomationEnabled: true } });
        const rule = await createMessageTriggerRule(db.raw, tracker, {
            branchId: a, eventType: "SERVICE_END", templateKey: "SERVICE_END_NOTICE",
        });
        const automaticJob = await fixture.jobs.create(MessageTriggerJobEntity.create({
            branchId: a, ruleId: rule.id, clientId: x.id, scheduledFor: JAN_1,
            recipientType: MessageTriggerRecipientType.CLIENT, recipientPhone: PHONE,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE, dedupeKey: randomUUID(),
            payload: { clientId: x.id, memberId: `client:${x.id}`, recipientPhone: PHONE,
                recipientName: x.name, templateVariables: { name: x.name } },
        }));
        expect(automaticJob).toMatchObject({ status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED });
        expect(fixture.provider.sendSms).toHaveBeenCalledTimes(1);
    });

    it("reconstructs a rejected transport retry from persisted rows after restart without storing its bearer", async () => {
        fixture.provider.sendSms.mockImplementationOnce(async request => ({
            request,
            response: { result_code: -999, success_cnt: 0, error_cnt: 1, msg_id: 0, message: request.message },
        }));
        const accepted = await fixture.issue.issue(input());
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({ status: "failed" });
        const first = await db.raw.message_log.findFirstOrThrow({ where: { triggerJobId: accepted.jobId } });
        expect(first).toMatchObject({ providerAcceptanceState: "rejected", errorMessage: "Standalone receipt delivery rejected" });
        const retry = fixture.retry();
        await expect(retry.retryById(a, first.id)).resolves.toMatchObject({ status: "sent" });
        expect(fixture.provider.sendSms).toHaveBeenCalledTimes(2);
        const firstMessage = fixture.provider.sendSms.mock.calls[0]![0].message;
        const retriedMessage = fixture.provider.sendSms.mock.calls[1]![0].message;
        expect(retriedMessage === firstMessage).toBe(true);
        const expandedUrl = firstMessage.split("\n").at(-1)!;
        const bearer = new URL(expandedUrl).pathname.split("/").at(-1)!;
        const persisted = JSON.stringify([await rows(), await tokens(), await db.raw.message_log.findMany({ where: { branchId: a } })]);
        expect([expandedUrl, bearer].some(secret => persisted.includes(secret))).toBe(false);
    });

    it("records a confidential uncertain outcome without resubmitting after restart", async () => {
        fixture.provider.sendSms.mockImplementationOnce(async request => {
            throw new Error([request.message, request.receiver, BIRTHDAY, "synthetic-signed-storage-url"].join(" "));
        });
        const accepted = await fixture.issue.issue(input());
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({ status: "failed" });
        const first = await db.raw.message_log.findFirstOrThrow({ where: { triggerJobId: accepted.jobId } });
        expect(first.providerAcceptanceState).toBe("uncertain");
        await expect(fixture.retry().retryById(a, first.id)).rejects.toMatchObject({ status: 409 });
        expect(fixture.provider.sendSms).toHaveBeenCalledTimes(1);
        expect(captureBackendError).toHaveBeenCalled();
        const output = JSON.stringify([diagnostics(), first.errorMessage]);
        const sent = fixture.provider.sendSms.mock.calls[0]![0];
        const url = sent.message.split("\n").at(-1)!;
        const bearer = new URL(url).pathname.split("/").at(-1)!;
        expect([sent.receiver, "QA-가", BIRTHDAY, url, bearer, "synthetic-signed-storage-url"]
            .some(secret => output.includes(secret))).toBe(false);
    });

    it("fails closed on an invalid profile and rejects an inactive branch before artwork", async () => {
        const invalidProfiles: Prisma.clientUncheckedUpdateInput[] = [
            { name: " " }, { birthday: "19940230" }, { phone: "bad" }, { startDate: null },
            { endDate: new Date("2025-11-30") }, { grant: null }, { fullPrice: "1,00원" },
            { fullPrice: "1000000000" }, { serviceStatus: "terminated" },
        ];
        for (const changes of invalidProfiles) {
            const valid = { name: x.name, birthday: x.birthday, phone: x.phone,
                startDate: x.startDate, endDate: x.endDate, grant: x.grant, fullPrice: x.fullPrice, serviceStatus: x.serviceStatus };
            await db.raw.client.update({ where: { id: x.id }, data: { ...valid, ...changes } });
            await expect(fixture.issue.issue(input())).rejects.toMatchObject({ status: 400, response: { code: "MISSING_RECEIPT_FIELDS" } });
            expect(await date()).toEqual(OLD_DATE);
        }
        fixture.load.mockClear();
        await db.raw.branch.update({ where: { id: a }, data: { isActive: false } });
        await expect(fixture.issue.issue(input())).rejects.toMatchObject({ status: 403 });
        expect(fixture.load).not.toHaveBeenCalled();
        expect(await rows()).toHaveLength(0);
        expect(await tokens()).toHaveLength(0);
        expect(fixture.storage.createPrivateObject).not.toHaveBeenCalled();
        expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    });

    it("serializes same-key requests across two connections and allows a new key and a distinct tenant", async () => {
        const peer = worker(db.raw);
        const arrived = barrier(2);
        fixture.load.mockImplementationOnce(async () => { await arrived(); return syntheticTemplate; });
        peer.load.mockImplementationOnce(async () => { await arrived(); return syntheticTemplate; });
        const request = input();
        const [first, replay] = await Promise.all([fixture.issue.issue(request), peer.issue.issue(request)]);
        expect(replay).toEqual(first);
        expect(await rows()).toHaveLength(1);
        await expect(peer.issue.issue({ ...request, copaymentReceivedDate: "2026-01-03" })).rejects.toMatchObject({ status: 409 });
        await expect(peer.issue.issue({ ...request, clientId: y.id })).rejects.toMatchObject({ status: 409 });
        await expect(peer.issue.issue({ ...request, clientId: foreign.id })).rejects.toMatchObject({ status: 404 });
        expect(await date(y.id)).toEqual(OLD_DATE);
        expect(await date()).toEqual(new Date(NEW_DATE));
        const other = await peer.issue.issue(input(request.requestId, foreign.id, "2026-01-03", b));
        expect(other.jobId).not.toBe(first.jobId);
        const deliberate = await fixture.issue.issue(input());
        await Promise.allSettled([fixture.dispatch(first.jobId), fixture.dispatch(first.jobId)]);
        expect(fixture.provider.sendSms).toHaveBeenCalledTimes(1);
        expect(await fixture.dispatch(deliberate.jobId)).toMatchObject({ status: "sent" });
        expect(fixture.provider.sendSms).toHaveBeenCalledTimes(2);
        expect(await rows()).toHaveLength(3);
    });

    it("arbitrates competing accessible client signatures at the request index", async () => {
        // Provision the branchless rule so both transactions reach the request index independently.
        await fixture.issue.issue(input());
        const peer = worker(db.raw);
        const arrived = barrier(2);
        fixture.load.mockImplementationOnce(async () => { await arrived(); return syntheticTemplate; });
        peer.load.mockImplementationOnce(async () => { await arrived(); return syntheticTemplate; });
        const requestId = randomUUID();
        const results = await Promise.allSettled([
            fixture.issue.issue(input(requestId, x.id, "2026-01-04")),
            peer.issue.issue(input(requestId, y.id, "2026-01-05")),
        ]);
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
        const winner = (await rows()).find(candidate => candidate.standaloneRequestId === requestId)!;
        expect(await date()).toEqual(new Date(winner.clientId === x.id ? "2026-01-04" : NEW_DATE));
        expect(await date(y.id)).toEqual(winner.clientId === y.id ? new Date("2026-01-05") : OLD_DATE);
    });

    it.each(["after insert", "after date update"])("rolls back %s and leaves the key reusable", async point => {
        const request = input();
        const failure = new Error("Synthetic transaction failure");
        const prisma = db.service;
        const transaction = prisma.$transaction.bind(prisma);
        const wrapper = {
            branch: prisma.branch, client: prisma.client, message_trigger_job: prisma.message_trigger_job,
            $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) =>
                transaction(async tx => {
                    const scoped = Object.create(tx) as Prisma.TransactionClient;
                    Object.defineProperty(scoped, "client", { value: {
                        findFirst: tx.client.findFirst.bind(tx.client),
                        update: async (...args: Parameters<typeof tx.client.update>) => {
                            if (point === "after date update") await tx.client.update(...args);
                            throw failure;
                        },
                    } });
                    return run(scoped);
                }, options),
        };
        const isolated = new StandaloneReceiptIssueService(wrapper as never, new MessageSenderApprovalService(prisma),
            { load: fixture.load } as never, fixture.tokenService, new SbMessageTriggerRuleRepository(prisma));
        await expect(isolated.issue(request)).rejects.toBe(failure);
        expect(await date()).toEqual(OLD_DATE);
        expect(await rows()).toHaveLength(0);
        expect(await fixture.issue.issue(request)).toMatchObject({ queued: true });
    });

    it("lets a peer bind the key when the first holder rolls back after inserting", async () => {
        await fixture.issue.issue(input(randomUUID(), x.id, "2026-01-01"));
        const sharedKey = randomUUID();
        const pool = db.service;
        const transaction = pool.$transaction.bind(pool);
        let announceInsertion!: () => void;
        const inserted = new Promise<void>(resolve => { announceInsertion = resolve; });
        let releaseHolder!: () => void;
        const peerReading = new Promise<void>(resolve => { releaseHolder = resolve; });
        const rollback = new Error("Synthetic first holder rollback");
        const holder = {
            branch: pool.branch, client: pool.client, message_trigger_job: pool.message_trigger_job,
            $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) =>
                transaction(async tx => {
                    const scoped = Object.create(tx) as Prisma.TransactionClient;
                    Object.defineProperty(scoped, "client", { value: {
                        findFirst: tx.client.findFirst.bind(tx.client),
                        update: async () => {
                            announceInsertion();
                            await peerReading;
                            throw rollback;
                        },
                    } });
                    return run(scoped);
                }, options),
        };
        const first = new StandaloneReceiptIssueService(holder as never, new MessageSenderApprovalService(pool),
            { load: fixture.load } as never, fixture.tokenService, new SbMessageTriggerRuleRepository(pool));
        const rejected = expect(first.issue(input(sharedKey, x.id))).rejects.toBe(rollback);
        await inserted;
        const peer = worker(db.raw);
        peer.load.mockImplementationOnce(async () => { releaseHolder(); return syntheticTemplate; });
        const committed = await peer.issue.issue(input(sharedKey, y.id, "2026-01-05"));
        await rejected;
        expect(await row(committed.jobId)).toMatchObject({ clientId: y.id, standaloneRequestId: sharedKey });
        expect(await date()).toEqual(JAN_1);
        expect(await date(y.id)).toEqual(new Date("2026-01-05"));
        expect((await rows()).filter(candidate => candidate.standaloneRequestId === sharedKey)).toHaveLength(1);
    });

    it("cancels terminally when artwork disappears after acceptance and replays without downloading it", async () => {
        fixture.load.mockResolvedValueOnce(syntheticTemplate).mockRejectedValue(new StandaloneReceiptTemplateUnavailableError());
        const request = input();
        const accepted = await fixture.issue.issue(request);
        expect(await date()).toEqual(new Date(NEW_DATE));
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({
            status: "canceled", cancelReason: "standalone_receipt_template_unavailable",
        });
        expect(await fixture.issue.issue(request)).toEqual(accepted);
        expect(fixture.load).toHaveBeenCalledTimes(2);
        expect(fixture.render).not.toHaveBeenCalled();
        expect(fixture.storage.createPrivateObject).not.toHaveBeenCalled();
        expect(await tokens()).toHaveLength(0);
        fixture.load.mockResolvedValue(syntheticTemplate);
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({ status: "canceled" });
        expect(await rows()).toHaveLength(1);
        expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    });

    it("admits an unsigned client and fails rendering before upload or provider admission", async () => {
        await createEformsignDoc(db.raw, tracker, { branchId: a, clientId: x.id, statusType: "020" });
        const accepted = await fixture.issue.issue(input());
        fixture.render.mockRejectedValueOnce(new Error("Synthetic renderer failure"));
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({ status: "canceled", cancelReason: "standalone_receipt_render_failed" });
        expect(await date()).toEqual(new Date(NEW_DATE));
        expect(await tokens()).toHaveLength(0);
        expect(fixture.storage.createPrivateObject).not.toHaveBeenCalled();
        expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    });

    it("stops a substituted token and a modified artifact before provider handoff", async () => {
        const first = await fixture.issue.issue(input());
        const second = await fixture.issue.issue(input());
        await fixture.preparation.resolve(await job(first.jobId), true);
        await fixture.preparation.resolve(await job(second.jobId), true);
        const issued = await tokens();
        const token = issued.find(candidate => candidate.jobId === first.jobId)!;
        await db.raw.message_trigger_job.update({ where: { id: second.jobId }, data: { standaloneIssuedTokenId: token.id } });
        expect(await fixture.dispatch(second.jobId)).toMatchObject({ status: "canceled", cancelReason: "standalone_receipt_unusable" });
        fixture.objects.set(token.storagePath, Buffer.from("synthetic unrelated object"));
        expect(await fixture.dispatch(first.jobId)).toMatchObject({ status: "canceled", cancelReason: "standalone_receipt_unusable" });
        expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    });

    it("recovers from a lost upload acknowledgement and preparation contention, and never reissues a removed token", async () => {
        const accepted = await fixture.issue.issue(input());
        const contender = await job(accepted.jobId);
        fixture.storage.createPrivateObject.mockImplementationOnce(async (bytes, path) => {
            fixture.objects.set(path, Buffer.from(bytes));
            throw new Error("Synthetic lost acknowledgement");
        });
        const [first, second] = await Promise.all([fixture.preparation.resolve(contender, true), fixture.preparation.resolve(contender, true)]);
        expect(first === second).toBe(true);
        expect(await tokens()).toHaveLength(1);
        expect(fixture.objects.size).toBe(1);
        fixture.render.mockClear();
        expect(await fixture.preparation.resolve(await job(accepted.jobId), true) === first).toBe(true);
        expect(fixture.render).not.toHaveBeenCalled();
        const [token] = await tokens();
        await db.raw.receipt_link_token.delete({ where: { id: token!.id } });
        await expect(fixture.preparation.resolve(await job(accepted.jobId), true)).rejects.toMatchObject({ reason: "standalone_receipt_unusable" });
        expect(await row(accepted.jobId)).toMatchObject({ standaloneIssuedTokenId: token!.id });
        expect(await tokens()).toHaveLength(0);
    });

    it("adopts the same private artifact after storage succeeds and preparation is interrupted", async () => {
        const accepted = await fixture.issue.issue(input());
        fixture.storage.download.mockRejectedValueOnce(new Error("Synthetic process interruption after upload"));
        await expect(fixture.preparation.resolve(await job(accepted.jobId), true)).rejects.toThrow("Standalone receipt object could not be read");
        expect(await tokens()).toHaveLength(0);
        expect(fixture.objects.size).toBe(1);
        const previousObject = [...fixture.objects.entries()][0]!;
        const bearer = await fixture.preparation.resolve(await job(accepted.jobId), true);
        expect(fixture.objects.get(previousObject[0]) === previousObject[1]).toBe(true);
        expect(await tokens()).toHaveLength(1);
        fixture.load.mockRejectedValue(new StandaloneReceiptTemplateUnavailableError());
        expect(await fixture.preparation.resolve(await job(accepted.jobId), true) === bearer).toBe(true);
        const [token] = await tokens();
        await db.raw.receipt_link_token.update({ where: { id: token!.id }, data: { active: false, revokedAt: JAN_1 } });
        expect(await fixture.tokenService.getStatus(bearer, JAN_1)).toEqual({ ok: false, reason: "revoked" });
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({ status: "canceled" });
        expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    });

    it("cancels sender approval loss before the final provider claim and stays canceled after approval returns", async () => {
        const accepted = await fixture.issue.issue(input());
        const originalRenderer = new StandaloneReceiptRenderer();
        fixture.render.mockImplementationOnce(async (template, snapshot) => {
            await db.raw.branch.update({ where: { id: a }, data: { smsSenderApprovalStatus: "not_requested" } });
            return originalRenderer.render(template, snapshot);
        });
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({ status: "canceled", cancelReason: MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON });
        await db.raw.branch.update({ where: { id: a }, data: { smsSenderApprovalStatus: "approved" } });
        expect(await fixture.dispatch(accepted.jobId)).toMatchObject({ status: "canceled" });
        const log = await db.raw.message_log.findFirstOrThrow({ where: { triggerJobId: accepted.jobId } });
        await expect(fixture.retry().retryById(a, log.id)).rejects.toMatchObject({ status: 409 });
        expect(await rows()).toHaveLength(1);
        expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    });

    it("rejects a same-name unique index with a different predicate", async () => {
        await expect(db.raw.$transaction(async tx => {
            await tx.$executeRaw`DROP INDEX uq_receipt_link_token_standalone_job`;
            await tx.$executeRaw`CREATE UNIQUE INDEX uq_receipt_link_token_standalone_job
                ON receipt_link_token(job_id) WHERE kind = 'contract'`;
            await tx.$executeRawUnsafe(verifier);
        })).rejects.toThrow("standalone receipt index uq_receipt_link_token_standalone_job does not match the approved definition");
        await expect(db.raw.$executeRawUnsafe(verifier)).resolves.toBeDefined();
    });

    it("detects a validated weaker named CHECK and preserves the real definition on rollback", async () => {
        await expect(db.raw.$executeRawUnsafe(verifier)).resolves.toBeDefined();
        await expect(db.raw.$transaction(async tx => {
            await tx.$executeRaw`ALTER TABLE receipt_link_token DROP CONSTRAINT receipt_link_token_kind_check`;
            await tx.$executeRaw`ALTER TABLE receipt_link_token ADD CONSTRAINT receipt_link_token_kind_check
                CHECK ((kind = 'contract' AND eformsign_doc_id IS NOT NULL)
                    OR (kind = 'standalone' AND frozen_client_name IS NOT NULL AND frozen_client_name ~ '[^[:space:]]'))`;
            await tx.$executeRawUnsafe(verifier);
        })).rejects.toThrow("receipt_link_token kind constraint does not match the approved definition");
        await expect(db.raw.$executeRawUnsafe(verifier)).resolves.toBeDefined();
    });
});
