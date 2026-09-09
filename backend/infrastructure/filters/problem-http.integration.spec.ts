import { Body, Controller, INestApplication, Post } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { IsDefined, IsString } from "class-validator";
import request from "supertest";

import { ServiceRecordSentryExceptionFilter } from "../observability/service-record-sentry-exception.filter";
import { GlobalValidationPipe } from "../pipes/global-validation.pipe";

jest.mock("../observability/service-record-sentry", () => ({
    captureBackendError: jest.fn(), captureServiceRecordError: jest.fn(),
    isServiceRecordSignal: () => false, getServiceRecordOperation: () => "context",
}));

class Input {
    @IsDefined() @IsString() name!: string;
    @IsDefined() @IsString() phone!: string;
}
let changes = 0;

@Controller("problem-probe")
class ProbeController {
    @Post()
    create(@Body() input: Input) {
        changes += 1;
        return { accepted: true, name: input.name };
    }

    @Post("uncertain")
    uncertain() {
        changes += 1;
        throw new Error("private database diagnostic");
    }
}

describe("problem contract over HTTP", () => {
    let app: INestApplication;
    beforeAll(async () => {
        const module = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)));
        await app.init();
    });
    beforeEach(() => { changes = 0; });
    afterAll(async () => { await app.close(); });

    it("returns both missing fields and leaves the operation unapplied", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe").send({}).expect(400);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body.requestId).toBe(response.headers["x-request-id"]);
        expect(response.body).toMatchObject({ code: "VALIDATION_FAILED", outcome: "NOT_APPLIED" });
        expect(new Set(response.body.errors.map((field: { pointer: string }) => field.pointer))).toEqual(new Set(["/name", "/phone"]));
        expect(changes).toBe(0);
        await request(app.getHttpServer()).post("/problem-probe").send({ name: "test", phone: "test" }).expect(201);
        expect(changes).toBe(1);
    });

    it("does not claim rollback when an error follows a completed change", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/uncertain").send({}).expect(500);
        expect(response.body.outcome).toBe("UNKNOWN");
        expect(JSON.stringify(response.body)).not.toContain("private database");
        expect(changes).toBe(1);
    });
});
