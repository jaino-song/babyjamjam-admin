import { INestApplication } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { getJwtSecret } from "infrastructure/auth/jwt-secret";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { PrismaService } from "infrastructure/database/prisma.service";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { TenantContext, TenantGuard } from "infrastructure/tenant";
import { AdminServiceRecordController } from "interface/controllers/admin-service-record.controller";

import {
    assertApprovedServiceRecordEditHttpDatabaseTarget,
    createAdminServiceRecordEditHttpFixture,
    createApprovedServiceRecordEditHttpClient,
    issueAdminServiceRecordEditHttpToken,
    type AdminServiceRecordEditHttpFixture,
} from "./helpers/admin-service-record-edit-http.helper";

const E2E_ENABLED = process.env["SERVICE_RECORD_EDIT_HTTP_E2E"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

describe("admin service-record HTTP target guard", () => {
    it("requires both URLs to name the approved loopback database", () => {
        expect(() => assertApprovedServiceRecordEditHttpDatabaseTarget("", "")).toThrow(
            /exact disposable task-4 database/,
        );
    });

    it("rejects a mismatched direct URL before a client can be constructed", () => {
        expect(() => assertApprovedServiceRecordEditHttpDatabaseTarget(
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task4",
            "postgresql://bjj_revision_test@127.0.0.1:62295/another_database",
        )).toThrow(/exact disposable task-4 database/);
    });
});

describeE2E("admin service-record HTTP authorization", () => {
    let app: INestApplication;
    let moduleFixture: TestingModule;
    let prisma: ReturnType<typeof createApprovedServiceRecordEditHttpClient>;
    let jwt: JwtService;
    let fixture: AdminServiceRecordEditHttpFixture;
    let editService: {
        startDraft: jest.Mock;
        getDraft: jest.Mock;
        updateDraft: jest.Mock;
        discardDraft: jest.Mock;
        previewDraft: jest.Mock;
        confirmDraft: jest.Mock;
    };

    const editorPath = (clientId: number): string => `/admin/service-records/client/${clientId}/editor`;
    const draftPath = (clientId: number): string => `/admin/service-records/client/${clientId}/draft`;

    beforeAll(async () => {
        // This assertion intentionally runs before constructing either Prisma
        // client or Nest application, so a missing/unsafe target fails closed.
        assertApprovedServiceRecordEditHttpDatabaseTarget();
        prisma = createApprovedServiceRecordEditHttpClient();
        fixture = await createAdminServiceRecordEditHttpFixture(prisma);

        editService = {
            startDraft: jest.fn().mockResolvedValue({
                draft: { id: "draft-http-1", status: "ACTIVE", changes: {} },
                sourceChanged: false,
            }),
            getDraft: jest.fn().mockResolvedValue({ draft: null, sourceChanged: false }),
            updateDraft: jest.fn().mockResolvedValue({ draft: null, sourceChanged: false }),
            discardDraft: jest.fn().mockResolvedValue({ draft: null, sourceChanged: false }),
            previewDraft: jest.fn().mockResolvedValue({ draft: null, sourceChanged: false }),
            confirmDraft: jest.fn().mockResolvedValue({ ok: true }),
        };

        moduleFixture = await Test.createTestingModule({
            imports: [
                PassportModule.register({ defaultStrategy: "jwt" }),
                JwtModule.register({ secret: getJwtSecret(), signOptions: { expiresIn: "7d" } }),
            ],
            controllers: [AdminServiceRecordController],
            providers: [
                // The real guards and strategy use the same Prisma client as
                // the fixture. No AppModule, scheduler, or vendor module is
                // imported into this narrow HTTP harness.
                { provide: PrismaService, useValue: prisma },
                { provide: ServiceRecordLinkService, useValue: {} },
                { provide: MessageTriggerService, useValue: {} },
                AdminServiceRecordService,
                { provide: AdminServiceRecordEditService, useValue: editService },
                JwtStrategy,
                JwtGuard,
                TenantContext,
                TenantGuard,
                OwnerOrAdminGuard,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
        jwt = moduleFixture.get(JwtService);
    }, 30_000);

    afterAll(async () => {
        await app?.close();
        await prisma?.$disconnect();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    async function tokenFor(
        subject: Parameters<typeof issueAdminServiceRecordEditHttpToken>[1],
        expiresIn?: number,
    ): Promise<string> {
        return issueAdminServiceRecordEditHttpToken(jwt, subject, expiresIn === undefined ? {} : { expiresIn });
    }

    it("returns 401 for an invalid bearer token", async () => {
        await request(app.getHttpServer())
            .get(editorPath(fixture.activeClientId))
            .set("Authorization", "Bearer not-a-jwt")
            .expect(401);
    });

    it("returns 401 for a valid access token whose session is expired", async () => {
        const token = await tokenFor(fixture.expiredSessionAdmin);
        await request(app.getHttpServer())
            .get(editorPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .expect(401);
    });

    it("returns 401 after the signed token's session is revoked", async () => {
        const token = await tokenFor(fixture.revokedSessionAdmin);
        await prisma.auth_session.update({
            where: { id: fixture.revokedSessionAdmin.sessionId },
            data: { revokedAt: new Date() },
        });

        await request(app.getHttpServer())
            .get(editorPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .expect(401);
    });

    it("returns 401 when a token subject is paired with another user's session", async () => {
        const token = await tokenFor(fixture.wrongSessionAdmin);
        await request(app.getHttpServer())
            .get(editorPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .expect(401);
    });

    it.each([
        ["a non-admin member", "nonAdmin"],
        ["an inactive branch member", "inactiveAdmin"],
        ["an admin without branch membership", "missingMembershipAdmin"],
    ] as const)("returns 403 for %s", async (_label, key) => {
        const token = await tokenFor(fixture[key]);
        await request(app.getHttpServer())
            .get(editorPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .expect(403);
    });

    it("allows an owner through the real tenant and owner/admin guards", async () => {
        const token = await tokenFor(fixture.owner);
        const response = await request(app.getHttpServer())
            .get(editorPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            record: null,
            assignments: [],
            scheduleProjection: expect.objectContaining({ entries: [] }),
        }));
    });

    it("allows a branch admin and passes the verified tenant actor to the draft service", async () => {
        const token = await tokenFor(fixture.admin);
        const response = await request(app.getHttpServer())
            .post(draftPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .send({ changes: { header: { momName: "Synthetic draft" } } })
            .expect(201);

        expect(response.body.draft.id).toBe("draft-http-1");
        expect(editService.startDraft).toHaveBeenCalledWith(
            fixture.activeBranchId,
            fixture.activeClientId,
            fixture.admin.userId,
            expect.objectContaining({ changes: { header: { momName: "Synthetic draft" } } }),
        );
    });

    it("returns 404 for an active admin requesting a client in another branch", async () => {
        const token = await tokenFor(fixture.admin);
        await request(app.getHttpServer())
            .get(editorPath(fixture.otherClientId))
            .set("Authorization", `Bearer ${token}`)
            .expect(404);
    });

    it("returns 400 for a forged body branch and does not call the draft service", async () => {
        const token = await tokenFor(fixture.admin);
        await request(app.getHttpServer())
            .post(draftPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .send({ branchId: fixture.otherBranchId })
            .expect(400);

        expect(editService.startDraft).not.toHaveBeenCalled();
    });

    it("returns 400 for a forged branch query instead of accepting query authority", async () => {
        const token = await tokenFor(fixture.admin);
        await request(app.getHttpServer())
            .get(editorPath(fixture.activeClientId))
            .query({ branchId: fixture.otherBranchId })
            .set("Authorization", `Bearer ${token}`)
            .expect(400);
    });

    it("does not let a query branch override the authenticated tenant on draft routes", async () => {
        const token = await tokenFor(fixture.admin);
        await request(app.getHttpServer())
            .post(`${draftPath(fixture.activeClientId)}?branchId=${encodeURIComponent(fixture.otherBranchId)}`)
            .set("Authorization", `Bearer ${token}`)
            .send({})
            .expect(400);
    });

    it("keeps the route's service error mapping branch-scoped", async () => {
        const token = await tokenFor(fixture.admin);
        const response = await request(app.getHttpServer())
            .get(editorPath(fixture.otherClientId))
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Client not found");
    });

    it("does not expose service internals on an unauthorized request", async () => {
        const token = await tokenFor(fixture.nonAdmin);
        await request(app.getHttpServer())
            .post(draftPath(fixture.activeClientId))
            .set("Authorization", `Bearer ${token}`)
            .send({ changes: { header: { momName: "blocked" } } })
            .expect(403);

        expect(editService.startDraft).not.toHaveBeenCalled();
    });
});
