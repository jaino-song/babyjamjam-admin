import "reflect-metadata";

import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import request from "supertest";

import { ClientService } from "application/services/client.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantGuard } from "infrastructure/tenant";

import { ClientController } from "./client.controller";

const BRANCH_ID = "11111111-1111-1111-1111-111111111111";

describe("ClientController GET /clients/service-record-missing", () => {
    let app: INestApplication;
    let controller: ClientController;
    const service = { getServiceRecordMissing: jest.fn(), findById: jest.fn() };
    const result = {
        count: 1,
        items: [{ clientId: 42, clientName: "김산모", primaryEmployeeName: "이관리", unwrittenThroughSessionIndex: 3 }],
    };
    const guard = {
        canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().tenant = { branchId: BRANCH_ID };
            return true;
        },
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ClientController],
            providers: [{ provide: ClientService, useValue: service }],
        })
            .overrideGuard(JwtGuard).useValue(guard)
            .overrideGuard(TenantGuard).useValue(guard)
            .compile();
        controller = moduleRef.get(ClientController);
        app = moduleRef.createNestApplication();
        await app.init();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        service.getServiceRecordMissing.mockResolvedValue(result);
        service.findById.mockResolvedValue({ id: 42 });
    });

    afterAll(async () => { await app?.close(); });

    it("routes the literal path ahead of :id and forwards the tenant branch", async () => {
        await request(app.getHttpServer()).get("/clients/service-record-missing").expect(200, result);
        expect(service.getServiceRecordMissing).toHaveBeenCalledTimes(1);
        expect(service.getServiceRecordMissing).toHaveBeenCalledWith(BRANCH_ID);
        expect(service.findById).not.toHaveBeenCalled();
    });

    it("keeps the numeric client lookup route available", async () => {
        await request(app.getHttpServer()).get("/clients/42").expect(200, { id: 42 });
        expect(service.findById).toHaveBeenCalledWith(BRANCH_ID, 42);
        expect(service.getServiceRecordMissing).not.toHaveBeenCalled();
    });

    it("forwards an absent tenant branch as an empty string", async () => {
        expect(await controller.getServiceRecordMissing({})).toEqual(result);
        expect(service.getServiceRecordMissing).toHaveBeenCalledWith("");
    });

    it("inherits the existing JWT and tenant guards", () => {
        expect(Reflect.getMetadata(GUARDS_METADATA, ClientController)).toEqual([JwtGuard, TenantGuard]);
        expect(Reflect.getMetadata(GUARDS_METADATA, controller.getServiceRecordMissing)).toBeUndefined();
    });
});

describe("ClientController PATCH /clients/:id expectedEndDate", () => {
    let app: INestApplication;
    const clientService = {
        update: jest.fn(),
    };

    const guard = {
        canActivate: (context: ExecutionContext) => {
            const requestContext = context.switchToHttp().getRequest();
            requestContext.user = { userId: "admin-1" };
            requestContext.tenant = {
                branchId: BRANCH_ID,
                userId: "admin-1",
                globalRole: "admin",
                branchRole: requestContext.headers["x-test-role"] ?? "admin",
            };
            return true;
        },
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ClientController],
            providers: [{ provide: ClientService, useValue: clientService }],
        })
            .overrideGuard(JwtGuard)
            .useValue(guard)
            .overrideGuard(TenantGuard)
            .useValue(guard)
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    afterAll(async () => {
        await app?.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        clientService.update.mockResolvedValue({ id: 42 });
    });

    it("lets expectedEndDate through the validation pipe and forwards it to the service", async () => {
        await request(app.getHttpServer())
            .patch("/clients/42")
            .send({ startDate: "2026-11-03", endDate: "2026-11-16", duration: 10, expectedEndDate: "2026-11-13" })
            .expect(200);

        expect(clientService.update).toHaveBeenCalledTimes(1);
        expect(clientService.update).toHaveBeenCalledWith(
            BRANCH_ID,
            42,
            expect.objectContaining({
                startDate: "2026-11-03",
                endDate: "2026-11-16",
                duration: 10,
                expectedEndDate: "2026-11-13",
            }),
        );
    });

    it("forwards a null expectedEndDate (the form was opened on a client without an end date)", async () => {
        await request(app.getHttpServer())
            .patch("/clients/42")
            .send({ startDate: "2026-11-03", expectedEndDate: null })
            .expect(200);

        expect(clientService.update).toHaveBeenCalledWith(
            BRANCH_ID,
            42,
            expect.objectContaining({ expectedEndDate: null }),
        );
    });

    it("leaves expectedEndDate undefined when the caller does not send it", async () => {
        await request(app.getHttpServer())
            .patch("/clients/42")
            .send({ address: "인천시 남동구" })
            .expect(200);

        const params = clientService.update.mock.calls[0][2];
        expect(params.address).toBe("인천시 남동구");
        expect(params.expectedEndDate).toBeUndefined();
    });

    it.each(["2026-11-13T00:00:00.000Z", "not-a-date", "20261113", 20261113])(
        "rejects a malformed expectedEndDate %p before the service sees it",
        async (value) => {
            await request(app.getHttpServer())
                .patch("/clients/42")
                .send({ endDate: "2026-11-16", expectedEndDate: value })
                .expect(400);

            expect(clientService.update).not.toHaveBeenCalled();
        },
    );

    it("still rejects undeclared fields", async () => {
        await request(app.getHttpServer())
            .patch("/clients/42")
            .send({ address: "인천시 남동구", notAField: 1 })
            .expect(400);

        expect(clientService.update).not.toHaveBeenCalled();
    });

    const binding = { caseId: "00000000-0000-4000-8000-000000000001", babyOrdinal: 1 };

    it("passes an explicit binding only through the manager-authorized UPDATE", async () => {
        await request(app.getHttpServer()).patch("/clients/42")
            .set("x-test-role", "manager").send({ legacyRecordBinding: binding }).expect(200);
        expect(clientService.update).toHaveBeenCalledWith(BRANCH_ID, 42, expect.any(Object), undefined, binding);
        await request(app.getHttpServer()).post("/clients")
            .send({ name: "QA", legacyRecordBinding: binding }).expect(400);
        expect(clientService.update).toHaveBeenCalledTimes(1);
    });

    it("rejects bindings from non-managers and marked mobile requests", async () => {
        for (const [name, value] of [["x-test-role", "user"], ["x-bjj-client", "mobile"]] as const) {
            await request(app.getHttpServer()).patch("/clients/42")
                .set(name, value).send({ legacyRecordBinding: binding }).expect(403);
        }
        expect(clientService.update).not.toHaveBeenCalled();
    });

    it.each([
        null, [], {}, { ...binding, caseId: "bad" }, { ...binding, babyOrdinal: "1" },
        { ...binding, babyOrdinal: 0 }, { ...binding, babyOrdinal: 1.5 }, { ...binding, employeeId: 1 },
    ])("rejects an invalid binding payload %p", async value => {
        await request(app.getHttpServer()).patch("/clients/42").send({ legacyRecordBinding: value }).expect(400);
        expect(clientService.update).not.toHaveBeenCalled();
    });
});
