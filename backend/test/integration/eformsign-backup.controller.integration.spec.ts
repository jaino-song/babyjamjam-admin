import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { EformsignBackupService } from "application/services/eformsign-backup.service";
import { EformsignBackupTokenGuard } from "infrastructure/auth/eformsign-backup-token.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { EformsignBackupInternalController } from "interface/controllers/eformsign-backup-internal.controller";
import { EformsignBackupRunsController } from "interface/controllers/eformsign-backup-runs.controller";

const ID = "11111111-1111-4111-8111-111111111111";
const bytes = Buffer.from([0, 255, 13, 10, 37, 80, 68, 70]);
const sha256 = "a".repeat(64);
const run = { startedAt: "2026-11-07T00:00:00.000Z", finishedAt: "2026-11-07T01:00:00.000Z",
    status: "success", limited: false, totalDocs: 1, savedFiles: 2, skippedFiles: 0, failedFiles: 0,
    driveStatus: "ok", failures: [] };

describe("eformsign backup controllers (HTTP)", () => {
    let app: INestApplication;
    let role: string;
    let token: string | undefined;
    const service = { listDocuments: jest.fn(), getFile: jest.fn(), createRun: jest.fn(), listRuns: jest.fn() };
    beforeEach(async () => {
        jest.resetAllMocks(); role = "owner"; token = "test-token";
        service.listDocuments.mockResolvedValue({ items: [], nextCursor: null });
        service.getFile.mockResolvedValue({ buffer: bytes, sha256 });
        service.createRun.mockResolvedValue({ id: ID });
        service.listRuns.mockResolvedValue({ items: [] });
        const module = await Test.createTestingModule({
            controllers: [EformsignBackupInternalController, EformsignBackupRunsController],
            providers: [EformsignBackupTokenGuard, OwnerGuard,
                { provide: ConfigService, useValue: { get: () => token } },
                { provide: EformsignBackupService, useValue: service }],
        }).overrideGuard(JwtGuard).useValue({
            canActivate: (context: ExecutionContext) => {
                context.switchToHttp().getRequest<{ user: { role: string } }>().user = { role };
                return true;
            },
        }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.listen(0, "127.0.0.1");
    });
    afterEach(async () => { await app.close(); });
    const internal = "/internal/eformsign-backup";

    it.each(["limit=0", "limit=201", "cursor=abc", "cursor=0", "limit=1.5"])("rejects %s", async (query) => {
        await request(app.getHttpServer()).get(`${internal}/documents?${query}`).set("Authorization", "Bearer test-token").expect(400);
        expect(service.listDocuments).not.toHaveBeenCalled();
    });
    it("applies default and explicit listing parameters", async () => {
        await request(app.getHttpServer()).get(`${internal}/documents`).set("Authorization", "Bearer test-token")
            .expect(200, { items: [], nextCursor: null });
        expect(service.listDocuments).toHaveBeenLastCalledWith(undefined, 200);
        await request(app.getHttpServer()).get(`${internal}/documents?cursor=7&limit=2`).set("Authorization", "Bearer test-token").expect(200);
        expect(service.listDocuments).toHaveBeenLastCalledWith(7, 2);
    });
    it("uses the real token guard on all internal routes", async () => {
        for (const path of ["documents", `files/${ID}`]) {
            await request(app.getHttpServer()).get(`${internal}/${path}`).expect(401);
        }
        await request(app.getHttpServer()).post(`${internal}/runs`).send(run).expect(401);
        token = undefined;
        await request(app.getHttpServer()).get(`${internal}/documents`).expect(404);
        await request(app.getHttpServer()).get(`${internal}/files/${ID}`).expect(404);
        await request(app.getHttpServer()).post(`${internal}/runs`).send(run).expect(404);
    });
    it("rejects a non-UUID file id", async () => {
        await request(app.getHttpServer()).get(`${internal}/files/invalid`).set("Authorization", "Bearer test-token").expect(400);
        expect(service.getFile).not.toHaveBeenCalled();
    });
    it("returns the exact file bytes and all required headers", async () => {
        const response = await request(app.getHttpServer()).get(`${internal}/files/${ID}`)
            .set("Authorization", "Bearer test-token").buffer(true).parse((res, done) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => done(null, Buffer.concat(chunks)));
            }).expect(200);
        expect(response.body).toEqual(bytes);
        expect(response.headers["x-content-sha256"]).toBe(sha256);
        expect(response.headers["content-type"]).toBe("application/pdf");
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["content-length"]).toBe(String(bytes.length));
    });
    it.each([
        { ...run, extra: true }, { ...run, status: "bad" }, { ...run, totalDocs: -1 },
        { ...run, totalDocs: 1.5 }, { ...run, driveStatus: "bad" }, { ...run, limited: "false" },
        { ...run, startedAt: "bad" }, { ...run, failures: [{ docId: "doc", reason: "a".repeat(501) }] },
        { ...run, failures: [{ docId: "doc", reason: "bad", extra: true }] },
    ])("rejects invalid run body %#", async (body) => {
        await request(app.getHttpServer()).post(`${internal}/runs`).set("Authorization", "Bearer test-token").send(body).expect(400);
        expect(service.createRun).not.toHaveBeenCalled();
    });
    it("creates a run with status 201", async () => {
        await request(app.getHttpServer()).post(`${internal}/runs`).set("Authorization", "Bearer test-token").send(run).expect(201, { id: ID });
        expect(service.createRun).toHaveBeenCalledWith(run);
    });
    it("allows owners and defaults history to 60", async () => {
        await request(app.getHttpServer()).get("/eformsign-backups/runs").expect(200, { items: [] });
        expect(service.listRuns).toHaveBeenCalledWith(60);
    });
    it("rejects a manager with the real OwnerGuard", async () => {
        role = "manager";
        await request(app.getHttpServer()).get("/eformsign-backups/runs").expect(403);
        expect(service.listRuns).not.toHaveBeenCalled();
    });
    it("caps history at 100", async () => {
        await request(app.getHttpServer()).get("/eformsign-backups/runs?limit=101").expect(400);
    });
});
