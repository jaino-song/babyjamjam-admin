import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { json } from "express";
import request from "supertest";

import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ClientModule } from "module/client.module";
import { EmployeeModule } from "module/employee.module";
import { EmployeeScheduleModule } from "module/employee-schedule.module";

const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
const OWNER_USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";
const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;

describeE2E("BJJ-275 full connected flow", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let finalizationService: ServiceRecordFinalizationService;
    let createDocumentSpy: jest.SpyInstance;

    const ownerJwtGuard = {
        canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = {
                userId: OWNER_USER_ID,
                role: "owner",
                branchId: BRANCH_ID,
                branchRole: "owner",
            };
            return true;
        },
    };

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                TenantModule,
                ClientModule,
                EmployeeModule,
                EmployeeScheduleModule,
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(ownerJwtGuard)
            .compile();

        app = moduleRef.createNestApplication();
        app.use(json({ limit: "1mb" }));
        app.useGlobalPipes(
            new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
        );
        await app.init();

        prisma = app.get(PrismaService);
        finalizationService = app.get(ServiceRecordFinalizationService);
        const eformsign = app.get<IEformsignClientRepository>(EFORMSIGN_CLIENT_REPOSITORY);
        createDocumentSpy = jest.spyOn(eformsign, "createDocument");
    });

    afterAll(async () => {
        createDocumentSpy?.mockRestore();
        await app?.close();
    });

    it("creates a contract client and completes assignment, messaging, entry, and finalization through vendor stubs", async () => {
        const runId = `${Date.now()}`.slice(-8);
        const employeePhone = `0108${runId}`.slice(0, 11);
        const clientPhone = `0109${runId}`.slice(0, 11);
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        const startDate = start.toISOString().slice(0, 10);
        const endDate = end.toISOString().slice(0, 10);

        const clientRes = await request(app.getHttpServer()).post("/clients").send({
            name: `전체흐름고객-${runId}`,
            phone: clientPhone,
            duration: 1,
            startDate,
            endDate,
            careCenter: false,
            voucherClient: false,
            breastPump: false,
            areaId: "namdong",
            source: "contract_auto_registration",
            suppressGreetingSms: false,
        });
        expect(clientRes.status).toBe(201);
        const clientId = clientRes.body.id as number;
        expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).suppressGreetingSms).toBe(true);

        const employeeRes = await request(app.getHttpServer()).post("/employees").send({
            name: `전체흐름직원-${runId}`,
            workArea: ["남동구"],
            phone: employeePhone,
            grade: "스탠다드",
            openToNextWork: true,
        });
        expect(employeeRes.status).toBe(201);
        const employeeId = employeeRes.body.id as number;
        expect(employeeId).toEqual(expect.any(Number));

        const scheduleRes = await request(app.getHttpServer()).post("/employee-schedules").send({
            clientId,
            primaryEmployeeId: employeeId,
            secondaryEmployeeId: null,
            workAddress: "인천 남동구 E2E로 1",
            startDate,
            endDate,
        });
        expect(scheduleRes.status).toBe(201);
        const scheduleId = scheduleRes.body.id as number;
        expect(await prisma.employee_schedule.findUnique({ where: { id: scheduleId } })).not.toBeNull();

        const prepared = await request(app.getHttpServer())
            .post(`/admin/service-records/schedules/${scheduleId}/prepare-link`)
            .send({ recipientPhone: employeePhone });
        expect(prepared.status).toBe(201);
        expect(prepared.body.preparedLinkToken).toEqual(expect.any(String));

        const sent = await request(app.getHttpServer())
            .post(`/admin/service-records/schedules/${scheduleId}/send-link`)
            .send({ preparedLinkToken: prepared.body.preparedLinkToken, recipientPhone: employeePhone });
        expect(sent.status).toBe(201);
        expect(sent.body.status).toBe("sent");
        expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: sent.body.jobId } })).status).toBe("sent");

        const link = await request(app.getHttpServer()).get(`/service-record/link/${prepared.body.preparedLinkToken}`);
        expect(link.status).toBe(200);
        expect(link.body.valid).toBe(true);

        const verified = await request(app.getHttpServer()).post("/service-record/verify").send({
            linkToken: prepared.body.preparedLinkToken,
            phone: employeePhone,
        });
        expect(verified.status).toBe(201);
        expect(verified.body.accessToken).toEqual(expect.any(String));
        const auth = { Authorization: `Bearer ${verified.body.accessToken}` };

        const header = await request(app.getHttpServer()).put("/service-record/header").set(auth).send({
            momName: "전체흐름산모",
            momBirth: "900101",
            babyName: "전체흐름아기",
            babyBirth: startDate.replaceAll("-", "").slice(2),
            deliveryType: "자연분만",
            babyWeight: "3.2kg",
        });
        expect(header.status).toBe(200);

        const submitted = await request(app.getHttpServer()).post("/service-record/sessions/1/submit").set(auth).send({
            serviceDate: startDate,
            answers: { sitzBath: "실시", sleep: "잘 잠", stool: "정상" },
            paymentConfirmed: true,
            momApproval: "approved",
            clientSignature: "data:image/png;base64,aQ==",
        });
        expect(submitted.status).toBe(201);

        const context = await request(app.getHttpServer()).get("/service-record/context").set(auth);
        expect(context.status).toBe(200);
        expect(context.body.sessions).toEqual(expect.arrayContaining([
            expect.objectContaining({ sessionIndex: 1, locked: true }),
        ]));

        const acknowledged = await request(app.getHttpServer()).post("/service-record/finalize").set(auth);
        expect(acknowledged.status).toBe(201);
        expect(acknowledged.body.status).toBe("WAITING_FOR_END");

        const serviceCase = await prisma.service_record_case.findUniqueOrThrow({ where: { clientId } });
        const dueAt = new Date(Date.now() - 60_000);
        await prisma.service_record_case.update({
            where: { id: serviceCase.id },
            data: { finalizationDueAt: dueAt },
        });
        const finalizedCount = await finalizationService.processDueCases(new Date());
        expect(finalizedCount).toBe(1);
        expect((await prisma.service_record_case.findUniqueOrThrow({ where: { id: serviceCase.id } })).status)
            .toBe("DOCUMENTS_CREATED");
        expect(createDocumentSpy).toHaveBeenCalled();
        expect(await prisma.eformsign_doc.count({
            where: { serviceRecordCaseId: serviceCase.id, documentKind: "service_record_snapshot" },
        })).toBeGreaterThan(0);
    }, 30_000);
});
