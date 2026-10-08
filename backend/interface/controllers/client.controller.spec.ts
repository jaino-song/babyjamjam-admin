import "reflect-metadata";

import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { ClientService } from "application/services/client.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantGuard } from "infrastructure/tenant";

import { ClientController } from "./client.controller";

const BRANCH_ID = "11111111-1111-1111-1111-111111111111";

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
                branchRole: "admin",
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
});
