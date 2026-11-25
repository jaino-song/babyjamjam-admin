import { Global, INestApplication, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import Redis from "ioredis";
import { type ChildProcess, fork, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import request from "supertest";

import { EformsignCredentialBoundary } from "application/services/eformsign-credential-boundary.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { NotificationService } from "application/services/notification.service";
import { SyncClientEndDateUsecase } from "application/usecases/eformsign-doc";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import { EFORMSIGN_CLIENT_REPOSITORY } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EformsignWebhookEventRow } from "domain/repositories/eformsign-webhook-event.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { EformsignBackupWakeTransport } from "infrastructure/realtime/eformsign-backup-wake-transport";
import { EformsignBackupModule } from "module/eformsign-backup.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { EformsignWebhookModule } from "module/eformsign-webhook.module";
import { HolidayModule } from "module/holiday.module";
import { NotificationModule } from "module/notification.module";
import { ServiceRecordEntryModule } from "module/service-record-entry.module";

const backupPath = "/internal/eformsign-backup";
const fixtureConfig = new Map([
    ["EFORMSIGN_BACKUP_TOKEN", "synthetic-backup-fixture"],
    ["EFORMSIGN_WEBHOOK_SECRET", "synthetic-webhook-fixture"],
    ["EFORMSIGN_COMPANY_ID", "fixture-company"],
]);

@Global()
@Module({
    providers: [{ provide: ConfigService, useValue: { get: (key: string) => fixtureConfig.get(key) } }],
    exports: [ConfigService],
})
class FixtureConfigModule {}

const webhookDependencies = [
    { provide: EformsignDocsEventBus, useValue: {} },
    { provide: SyncClientEndDateUsecase, useValue: {} },
    { provide: EformsignCredentialBoundary, useValue: {} },
    { provide: MirrorUnassignedEformsignDocUsecase, useValue: { mirrorRemoteDocument: jest.fn() } },
    { provide: EformsignDocumentMirrorService, useValue: {
        syncDocument: jest.fn(), isDocumentReady: () => true,
        getStoredDetail: (docId: string) => ({ current_status: { status_type: docId === "drop" ? "070" : "003" } }),
    } },
];
@Module({ providers: webhookDependencies, exports: webhookDependencies })
class FixtureDocsModule {}
@Module({ providers: [{ provide: NotificationService, useValue: {} }], exports: [NotificationService] })
class FixtureNotificationModule {}
@Module({ providers: [{ provide: HolidayCalendarService, useValue: {} }], exports: [HolidayCalendarService] })
class FixtureHolidayModule {}
@Module({})
class FixtureServiceRecordModule {}

async function eventually<T>(read: () => T | false | undefined | Promise<T | false | undefined>, description: string): Promise<T> {
    const deadline = performance.now() + 7_500;
    do {
        const value = await read();
        if (value) return value;
        await delay(10);
    } while (performance.now() < deadline);
    throw new Error(`Timed out waiting for ${description}`);
}

function fixtureLedger() {
    const rows: (EformsignWebhookEventRow & { id: number; createdAt: Date })[] = [];
    const clock = new Date("2026-11-24T00:08:00.000Z");
    const insert = jest.fn(async ({ data }: { data: EformsignWebhookEventRow }) => {
        rows.push({ ...data, createdAt: clock, id: rows.length + 1 });
    });
    const findMany = jest.fn(async ({ where, take }: {
        where: { eventType: string; id: { gt: number }; createdAt: { gte: Date; lt: Date } }; take: number;
    }) => rows.filter((row) => (
        row.eventType === where.eventType && row.documentId && row.id > where.id.gt
        && row.createdAt >= where.createdAt.gte && row.createdAt < where.createdAt.lt
    )).slice(0, take));
    const cutoff = jest.fn(async () => [{ cutoff: new Date(clock.getTime() + 1) }]);
    return { rows, insert, findMany, cutoff, prisma: {
        eformsign_webhook_event: { create: insert, findMany }, $queryRaw: cutoff,
    } };
}

async function startApp(ledger: ReturnType<typeof fixtureLedger>): Promise<INestApplication> {
    const fixture = await Test.createTestingModule({
        imports: [FixtureConfigModule, EformsignWebhookModule, EformsignBackupModule],
    })
        .overrideModule(EformsignDocModule).useModule(FixtureDocsModule)
        .overrideModule(NotificationModule).useModule(FixtureNotificationModule)
        .overrideModule(HolidayModule).useModule(FixtureHolidayModule)
        .overrideModule(ServiceRecordEntryModule).useModule(FixtureServiceRecordModule)
        .overrideProvider(PrismaService).useValue(ledger.prisma)
        .overrideProvider(EFORMSIGN_CLIENT_REPOSITORY).useValue({})
        .overrideProvider(EFORMSIGN_DOC_REPOSITORY).useValue({ findByDocumentIdUnscoped: async () => null })
        .compile();
    const app = fixture.createNestApplication({ logger: false });
    app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    try {
        await app.listen(0, "127.0.0.1");
        return app;
    } catch (error) {
        await app.close();
        throw error;
    }
}

function post(app: INestApplication, docId: string, eventType = "ready_document_pdf") {
    const common = {
        document_title: "fixture", workflow_seq: 1, workflow_name: "fixture",
        template_id: "fixture", template_name: "fixture",
    };
    const detail = eventType === "document"
        ? { document: { ...common, id: docId, status: "doc_create", updated_date: 1795478400000 } }
        : { ready_document_pdf: { ...common, document_id: docId, document_status: "doc_complete" } };
    return request(app.getHttpServer()).post("/webhooks/eformsign")
        .set("Authorization", "Bearer synthetic-webhook-fixture")
        .send({
            webhook_id: "fixture-webhook", webhook_name: "fixture", company_id: "fixture-company", event_type: eventType,
            ...detail,
        }).expect(200, { success: true });
}

type WorkerMessage = { connected?: number; frame?: string; delivered?: string; drained?: boolean };

function stopFixture(child: ChildProcess, name: string) {
    const exited = once(child, "close");
    return async () => {
        const timer = new AbortController();
        child.kill("SIGTERM");
        try {
            const closed = await Promise.race([exited, delay(3_000, null, { signal: timer.signal })]);
            if (!closed) {
                child.kill("SIGKILL");
                if (!await Promise.race([exited, delay(2_000, null, { signal: timer.signal })])) {
                    throw new Error(`Could not reap ${name} after SIGKILL`);
                }
                throw new Error(`${name} required SIGKILL after SIGTERM`);
            }
        } finally {
            timer.abort();
        }
    };
}

async function startWorker(app: INestApplication, root: string) {
    const messages: WorkerMessage[] = [];
    const worker = fork(join(__dirname, "eformsign-backup-wake-worker.fixture.mjs"), [await app.getUrl(), root], {
        execArgv: [], env: {}, stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    worker.on("message", (message: WorkerMessage) => messages.push(message));
    return { messages, stop: stopFixture(worker, "wake worker") };
}

const haveRedis = spawnSync("redis-server", ["--version"]).status === 0;
const redisTest = haveRedis || process.env["CI"] === "true" ? it : it.skip;
async function startRedis(root: string) {
    if (!haveRedis) throw new Error("redis-server is required for the private Redis wake tests in CI");
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const { port } = reservation.address() as AddressInfo;
    await new Promise<void>((done) => reservation.close(() => done()));
    const child = spawn("redis-server", [
        "--bind", "127.0.0.1", "--port", String(port), "--dir", root, "--save", "", "--appendonly", "no",
    ], { stdio: ["ignore", "pipe", "inherit"] });
    const stop = stopFixture(child, "private Redis");
    let output = "";
    let ready = false;
    child.stdout?.on("data", (data: Buffer) => {
        if (ready) return;
        output = output.slice(-64) + data.toString();
        ready = output.includes("Ready to accept connections");
    });
    try {
        await eventually(() => ready, "private Redis startup");
        return { url: `redis://127.0.0.1:${port}`, stop };
    } catch (error) {
        await stop();
        throw error;
    }
}

describe("private eformsign backup wake", () => {
    let root: string;
    let ledger: ReturnType<typeof fixtureLedger>;
    let previousUrl: string | undefined;
    const cleanup: (() => Promise<void>)[] = [];

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "eformsign-wake-"));
        ledger = fixtureLedger();
        previousUrl = process.env["VALKEY_URL"];
        delete process.env["VALKEY_URL"];
    });
    afterEach(async () => {
        const errors: unknown[] = [];
        try {
            for (const stop of cleanup.reverse()) {
                try { await stop(); }
                catch (error) { errors.push(error); }
            }
        } finally {
            cleanup.length = 0;
            if (previousUrl === undefined) delete process.env["VALKEY_URL"];
            else process.env["VALKEY_URL"] = previousUrl;
            await rm(root, { recursive: true, force: true });
        }
        if (errors.length) throw new AggregateError(errors, "Private wake fixture cleanup failed");
    });
    const openApp = async () => {
        const app = await startApp(ledger);
        cleanup.push(() => app.close());
        return app;
    };
    const openWorker = async (app: INestApplication) => {
        const worker = await startWorker(app, root);
        cleanup.push(worker.stop);
        return worker.messages;
    };

    it("uses the real guarded stream and both webhook writer paths, after persistence only", async () => {
        const app = await openApp();
        await request(app.getHttpServer()).get(`${backupPath}/ready-wake`).expect(401);
        await request(app.getHttpServer()).get(`${backupPath}/ready-events/cutoff`).expect(401);
        expect(ledger.cutoff).not.toHaveBeenCalled();
        const messages = await openWorker(app);
        await eventually(() => messages.some((message) => message.drained), "subscribed catch-up");
        expect(messages.slice(0, 3)).toEqual([{ connected: 200 }, { frame: "ready" }, { drained: true }]);

        const originalInsert = ledger.insert.getMockImplementation();
        if (!originalInsert) throw new Error("Missing fixture insert");
        let release: () => void = () => { throw new Error("Fixture gate not installed"); };
        const gate = new Promise<void>((resolve) => { release = resolve; });
        ledger.insert.mockImplementationOnce(async (query) => {
            await gate;
            await originalInsert(query);
        });
        const pending = post(app, "first").then(() => undefined);
        try {
            await eventually(() => ledger.insert.mock.calls.length === 1, "deferred webhook insert");
            expect(messages).toHaveLength(3);
            expect(ledger.rows).toHaveLength(0);
        } finally {
            release();
            await pending;
        }
        await eventually(() => messages.some((message) => message.delivered === "first"), "post-commit worker delivery");
        expect(ledger.rows[0]?.outcome).toBe("applied");

        await post(app, "ordinary", "document");
        ledger.insert.mockRejectedValueOnce(new Error("synthetic insert failure"));
        await post(app, "failed");
        const writer = app.get(EformsignWebhookEventWriter);
        await writer.append({ eventType: "ready_document_pdf", documentId: "  ", outcome: "missing_document_id" });
        await writer.append({ eventType: "ready_document_pdf", documentId: "bad id", outcome: "missing_document_id" });
        await post(app, "drop");
        await eventually(() => messages.some((message) => message.delivered === "drop"), "controller ledger wake");
        expect(messages.filter((message) => message.frame === "wake")).toHaveLength(2);
        expect(ledger.rows.at(-1)?.outcome).toBe("ignored_stale_mirror");
        expect(messages.flatMap(({ delivered }) => delivered ? [delivered] : [])).toEqual(["first", "drop"]);

        const notify = jest.spyOn(app.get(EformsignBackupWakeTransport), "notify").mockImplementationOnce(() => {
            throw new Error("synthetic notification failure");
        });
        await post(app, "notification-failed");
        expect(notify).toHaveBeenCalledTimes(1);
        expect(ledger.rows.at(-1)?.documentId).toBe("notification-failed");
    });

    redisTest("delivers across independent Valkey providers and catches up after subscriber loss in place", async () => {
        const redis = await startRedis(root);
        cleanup.push(redis.stop);
        const admin = new Redis(redis.url, { commandTimeout: 2_000 });
        cleanup.push(async () => admin.disconnect());
        process.env["VALKEY_URL"] = redis.url;
        const producer = await openApp();
        const subscriberIds = async () => String(await admin.client("LIST")).split("\n")
            .filter((line) => /\bsub=1\b/.test(line)).map((line) => line.match(/^id=(\d+)/)?.[1]);
        const producerId = await eventually(async () => {
            const ids = await subscriberIds();
            return ids.length === 1 && ids[0];
        }, "producer subscription acknowledgement");
        const consumer = await openApp();
        const messages = await openWorker(consumer);
        await eventually(() => messages.some((message) => message.drained), "consumer subscription acknowledgement");
        const consumerId = (await subscriberIds()).find((id) => id !== producerId);
        if (!consumerId) throw new Error("Expected a separate consumer subscription");
        await post(producer, "cross-instance");
        await eventually(() => messages.some((message) => message.delivered === "cross-instance"), "cross-instance wake");
        expect(messages.filter((message) => message.frame === "wake")).toHaveLength(1);
        await admin.client("KILL", "ID", consumerId);
        await post(producer, "missed");
        await eventually(() => messages.some((message) => message.delivered === "missed"), "catch-up after subscription restoration");
        expect(messages.filter((message) => message.connected === 200)).toHaveLength(1);
        expect(messages.filter((message) => message.frame === "ready")).toHaveLength(2);
        expect(messages.filter((message) => message.frame === "wake")).toHaveLength(1);
    });

    redisTest("flushes a persisted pending wake after a transient publisher disconnect without another webhook", async () => {
        const redis = await startRedis(root);
        cleanup.push(redis.stop);
        const admin = new Redis(redis.url, { commandTimeout: 2_000 });
        cleanup.push(async () => admin.disconnect());

        const username = "fixture-publisher";
        const password = randomBytes(32).toString("hex");
        await admin.acl("SETUSER", username, "on", `>${password}`, "~*", "&*", "+@all");
        const producerUrl = new URL(redis.url);
        producerUrl.username = username;
        producerUrl.password = password;
        process.env["VALKEY_URL"] = producerUrl.href;
        const producer = await openApp();
        const publisher = producer.get(EformsignBackupWakeTransport)["publisher"];
        if (!publisher) throw new Error("Expected a separate publisher connection");
        await eventually(() => publisher.status === "ready", "initial publisher connection");
        const originalId = String(await publisher.client("ID"));

        process.env["VALKEY_URL"] = redis.url;
        const consumer = await openApp();
        const messages = await openWorker(consumer);
        const drained = () => messages.filter((message) => message.drained).length;
        await eventually(() => drained() === 1, "initial consumer catch-up");

        // Prevent reauthentication until the persisted event has been observed.
        // Killing this socket leaves the independently connected consumer live.
        let authenticationRejected = false;
        publisher.on("error", (error: Error) => {
            if (error.message.startsWith("WRONGPASS ")) authenticationRejected = true;
        });
        await admin.acl("SETUSER", username, "off");
        await admin.client("KILL", "ID", originalId);
        await eventually(() => publisher.status !== "ready", "publisher disconnect");
        await post(producer, "publisher-recovery");
        expect(ledger.rows.map((row) => row.documentId)).toEqual(["publisher-recovery"]);
        expect(messages.filter((message) => message.frame === "wake")).toHaveLength(0);
        expect(drained()).toBe(1);

        await eventually(() => authenticationRejected, "publisher reauthentication rejection");
        await admin.acl("SETUSER", username, "on");
        await eventually(() => drained() === 2, "delivery following publisher recovery");
        expect(String(await publisher.client("ID"))).not.toBe(originalId);
        expect(messages.filter((message) => message.frame === "ready")).toHaveLength(1);
        expect(messages.filter((message) => message.frame === "wake")).toHaveLength(1);
        expect(messages.flatMap(({ delivered }) => delivered ? [delivered] : [])).toEqual(["publisher-recovery"]);

        const subscribers = String(await admin.client("LIST")).split("\n");
        const consumerId = subscribers.find((line) => /\bsub=1\b/.test(line) && /\buser=default\b/.test(line))
            ?.match(/^id=(\d+)/)?.[1];
        if (!consumerId) throw new Error("Expected the consumer subscriber socket");
        await admin.client("KILL", "ID", consumerId);
        await eventually(() => drained() === 3, "consumer catch-up over the same persisted event");
        expect(messages.flatMap(({ delivered }) => delivered ? [delivered] : [])).toEqual(["publisher-recovery"]);
        expect(ledger.rows).toHaveLength(1);
    });
});
