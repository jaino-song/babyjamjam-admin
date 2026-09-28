import {
    CanActivate,
    ExecutionContext,
    INestApplication,
    UnauthorizedException,
    ValidationPipe,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { BankAccountInfoController } from "interface/controllers/bank-account-info.controller";
import { ClientController } from "interface/controllers/client.controller";
import { DocumentCategoryController } from "interface/controllers/document-category.controller";
import { EmployeeController } from "interface/controllers/employee.controller";
import { EmployeeScheduleController } from "interface/controllers/employee-schedule.controller";
import { ScheduleChangeController } from "interface/controllers/schedule-change.controller";
import { CallIngestTokenController } from "interface/controllers/call-ingest-token.controller";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { ClientService } from "application/services/client.service";
import { DocumentCategoryService } from "application/services/document-category.service";
import { EmployeeService } from "application/services/employee.service";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

type BranchRole = "owner" | "admin" | "manager" | "user";
type Principal = { userId: string; role: "owner" | "user"; branchId: string };

const BRANCH_A = "branch-a-id";
const BRANCH_B = "branch-b-id";

const activationBody = {
    name: "Tenant client",
    primaryEmployeeId: 10,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    confirmedUnavailableEmployeeIds: [10],
};

const scheduleBody = {
    clientId: 1,
    primaryEmployeeId: 10,
    workAddress: "Seoul",
    startDate: "2026-10-01",
    endDate: "2026-10-10",
};

describe("branch-manager role policy (HTTP integration)", () => {
    let app: INestApplication;
    let currentUser: Principal | undefined;
    let membership: { role: Exclude<BranchRole, "owner">; branch: { isActive: boolean } } | null;
    let employeeService: Record<string, jest.Mock>;
    let bankService: Record<string, jest.Mock>;
    let clientService: Record<string, jest.Mock>;
    let categoryService: Record<string, jest.Mock>;
    let scheduleService: Record<string, jest.Mock>;
    let scheduleChangeService: Record<string, jest.Mock>;
    let tokenService: Record<string, jest.Mock>;
    let branchFindUnique: jest.Mock;
    let membershipFindUnique: jest.Mock;

    const jwtGuard: CanActivate = {
        canActivate(context: ExecutionContext): boolean {
            if (!currentUser) throw new UnauthorizedException();
            context.switchToHttp().getRequest().user = currentUser;
            return true;
        },
    };

    const setPrincipal = (role: BranchRole, branchId = BRANCH_A, active = true): void => {
        currentUser = {
            userId: `${role}-user`,
            role: role === "owner" ? "owner" : "user",
            branchId,
        };
        membership = role === "owner" ? null : { role, branch: { isActive: active } };
    };

    beforeEach(async () => {
        currentUser = undefined;
        membership = null;
        employeeService = {
            create: jest.fn().mockResolvedValue({ id: 1 }),
            changeOpenStatus: jest.fn().mockResolvedValue({ id: 1 }),
            update: jest.fn().mockResolvedValue({ id: 1 }),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        bankService = {
            create: jest.fn().mockResolvedValue({ area: "Seoul" }),
            update: jest.fn().mockResolvedValue({ area: "Seoul" }),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        clientService = { create: jest.fn().mockResolvedValue({ id: 1 }) };
        categoryService = {
            create: jest.fn().mockResolvedValue({ id: "category-1" }),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        scheduleService = {
            create: jest.fn().mockResolvedValue({ id: 1 }),
            update: jest.fn().mockResolvedValue({ id: 1 }),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        scheduleChangeService = {
            applyAdminChange: jest.fn().mockResolvedValue({ id: "change-1" }),
            approve: jest.fn().mockResolvedValue({ id: "change-1" }),
            reject: jest.fn().mockResolvedValue({ id: "change-1" }),
        };
        tokenService = {
            createToken: jest.fn().mockResolvedValue({ id: "token-1", token: "secret" }),
            list: jest.fn().mockResolvedValue([]),
            revoke: jest.fn().mockResolvedValue(undefined),
        };
        branchFindUnique = jest.fn().mockResolvedValue({ id: BRANCH_A, isActive: true });
        membershipFindUnique = jest.fn().mockImplementation(async () => membership);

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [
                BankAccountInfoController,
                ClientController,
                DocumentCategoryController,
                EmployeeController,
                EmployeeScheduleController,
                ScheduleChangeController,
                CallIngestTokenController,
            ],
            providers: [
                TenantGuard,
                TenantContext,
                BranchManagerGuard,
                {
                    provide: PrismaService,
                    useValue: {
                        branch: { findUnique: branchFindUnique },
                        user_branch: {
                            findFirst: membershipFindUnique,
                            findUnique: membershipFindUnique,
                        },
                    },
                },
                { provide: BankAccountInfoService, useValue: bankService },
                { provide: ClientService, useValue: clientService },
                { provide: DocumentCategoryService, useValue: categoryService },
                { provide: EmployeeService, useValue: employeeService },
                { provide: EmployeeScheduleService, useValue: scheduleService },
                { provide: ScheduleChangeService, useValue: scheduleChangeService },
                { provide: CallIngestTokenService, useValue: tokenService },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(jwtGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const allRoleRoutes = [
        {
            name: "employee create",
            invoke: () => request(app.getHttpServer()).post("/employees").send({
                name: "New employee",
                workArea: ["Seoul"],
                phone: "010-9999-8888",
                grade: "베스트",
                openToNextWork: true,
            }),
        },
        {
            name: "employee availability",
            invoke: () => request(app.getHttpServer()).patch("/employees/open-status").query({ id: "1" }).send({ openToNextWork: true }),
        },
        {
            name: "employee schedule create",
            invoke: () => request(app.getHttpServer()).post("/employee-schedules").send(scheduleBody),
        },
        {
            name: "employee schedule update",
            invoke: () => request(app.getHttpServer()).patch("/employee-schedules").query({ id: "1" }).send({ workAddress: "Busan" }),
        },
        {
            name: "employee schedule delete",
            invoke: () => request(app.getHttpServer()).delete("/employee-schedules").query({ id: "1" }),
        },
        {
            name: "schedule change apply",
            invoke: () => request(app.getHttpServer()).post("/schedule-change-requests/schedules/1/apply").send({ toDate: "2026-10-11" }),
        },
        {
            name: "schedule change approve",
            invoke: () => request(app.getHttpServer()).post("/schedule-change-requests/change-1/approve"),
        },
        {
            name: "schedule change reject",
            invoke: () => request(app.getHttpServer()).post("/schedule-change-requests/change-1/reject").send({ reason: "reschedule" }),
        },
        {
            name: "client activation",
            invoke: () => request(app.getHttpServer()).post("/clients/with-employee-activation").send(activationBody),
        },
        {
            name: "document category create",
            invoke: () => request(app.getHttpServer()).post("/document-categories").send({ value: "custom", label: "Custom", color: "blue" }),
        },
        {
            name: "document category delete",
            invoke: () => request(app.getHttpServer()).delete("/document-categories/category-1"),
        },
    ] as const;

    const managerRoutes = [
        {
            name: "bank create",
            invoke: () => request(app.getHttpServer()).post("/bank-account-infos").send({ area: "Seoul", bankName: "은행", accNum: "123" }),
        },
        {
            name: "bank update",
            invoke: () => request(app.getHttpServer()).patch("/bank-account-infos").query({ area: "Seoul" }).send({ bankName: "은행" }),
        },
        {
            name: "bank delete",
            invoke: () => request(app.getHttpServer()).delete("/bank-account-infos").query({ area: "Seoul" }),
        },
        {
            name: "call ingest token create",
            invoke: () => request(app.getHttpServer()).post(`/branches/${BRANCH_A}/call-ingest-tokens`).send({ label: "automation" }),
        },
    ] as const;

    it.each(allRoleRoutes)("allows all active roles on $name", async ({ invoke }) => {
        for (const role of ["owner", "admin", "manager", "user"] as const) {
            setPrincipal(role);
            const response = await invoke();
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`${role} returned ${response.status}: ${JSON.stringify(response.body)}`);
            }
        }
    });

    it.each(managerRoutes)("allows owner/admin/manager but denies user on $name", async ({ invoke }) => {
        for (const role of ["owner", "admin", "manager"] as const) {
            setPrincipal(role);
            const response = await invoke();
            expect(response.status).toBeGreaterThanOrEqual(200);
            expect(response.status).toBeLessThan(300);
        }
        setPrincipal("user");
        expect((await invoke()).status).toBe(403);
    });

    const managerOnlyRoutes = [
        {
            name: "employee update",
            invoke: () => request(app.getHttpServer()).patch("/employees").query({ id: "1" }).send({ name: "Updated" }),
        },
        {
            name: "employee delete",
            invoke: () => request(app.getHttpServer()).delete("/employees").query({ id: "1" }),
        },
    ] as const;

    it.each(managerOnlyRoutes)("allows manager but denies user on $name", async ({ invoke }) => {
        setPrincipal("manager");
        expect((await invoke()).status).toBeGreaterThanOrEqual(200);
        setPrincipal("user");
        expect((await invoke()).status).toBe(403);
    });

    it("fails closed for anonymous, missing membership, inactive membership, and cross-branch writes", async () => {
        expect((await request(app.getHttpServer()).post("/employees").send({ name: "x", workArea: ["Seoul"], phone: "01099998888", grade: "베스트", openToNextWork: true })).status).toBe(401);

        setPrincipal("manager");
        membership = null;
        expect((await request(app.getHttpServer()).post("/employees").send({ name: "x", workArea: ["Seoul"], phone: "01099998888", grade: "베스트", openToNextWork: true })).status).toBe(403);

        setPrincipal("manager", BRANCH_A, false);
        expect((await request(app.getHttpServer()).post("/employees").send({ name: "x", workArea: ["Seoul"], phone: "01099998888", grade: "베스트", openToNextWork: true })).status).toBe(403);

        setPrincipal("manager", BRANCH_B);
        await request(app.getHttpServer()).post("/bank-account-infos").send({ area: "Seoul", bankName: "은행", accNum: "123" }).expect(201);
        expect(bankService["create"]).toHaveBeenLastCalledWith(expect.any(Object), BRANCH_B);
        expect(bankService["create"]).not.toHaveBeenCalledWith(expect.any(Object), BRANCH_A);
    });
});
