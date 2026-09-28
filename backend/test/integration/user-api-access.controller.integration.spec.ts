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
import { VoucherPriceInfoController } from "interface/controllers/voucher-price-info.controller";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { ClientService } from "application/services/client.service";
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

type TestRole = "owner" | "admin" | "manager" | "user";

type TestPrincipal = {
    userId: string;
    role: TestRole;
    branchId: string;
};

const BRANCH_A = "branch-a-id";
const BRANCH_B = "branch-b-id";

const activationBody = {
    name: "Tenant member client",
    primaryEmployeeId: 10,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    confirmedUnavailableEmployeeIds: [10],
};

describe("user API access controller guards (HTTP integration)", () => {
    let app: INestApplication;
    let currentUser: TestPrincipal | undefined;
    let membership: { role: TestRole; branch: { isActive: boolean } } | null;
    let bankAccountInfoService: { findAll: jest.Mock };
    let clientService: { create: jest.Mock; findAll: jest.Mock };
    let voucherPriceInfoService: { list: jest.Mock };
    let branchFindUnique: jest.Mock;
    let membershipFindFirst: jest.Mock;

    const testJwtGuard: CanActivate = {
        canActivate(context: ExecutionContext): boolean {
            if (!currentUser) {
                throw new UnauthorizedException();
            }
            context.switchToHttp().getRequest().user = currentUser;
            return true;
        },
    };

    const setPrincipal = (role: TestRole, branchId = BRANCH_A): void => {
        currentUser = {
            userId: `${role}-user-id`,
            role,
            branchId,
        };
        membership = role === "owner"
            ? null
            : { role, branch: { isActive: true } };
    };

    const requestFor = (route: "voucher" | "bank" | "client") => {
        if (route === "voucher") {
            return request(app.getHttpServer()).get("/voucher-price-infos");
        }
        if (route === "bank") {
            return request(app.getHttpServer()).get("/bank-account-infos");
        }
        return request(app.getHttpServer())
            .post("/clients/with-employee-activation")
            .send(activationBody);
    };

    beforeEach(async () => {
        currentUser = undefined;
        membership = null;

        bankAccountInfoService = {
            findAll: jest.fn().mockResolvedValue([]),
        };
        clientService = {
            create: jest.fn().mockResolvedValue({ id: 1, name: activationBody.name }),
            findAll: jest.fn().mockResolvedValue([]),
        };
        voucherPriceInfoService = {
            list: jest.fn().mockResolvedValue([]),
        };
        branchFindUnique = jest.fn().mockImplementation(async () => ({ isActive: true }));
        membershipFindFirst = jest.fn().mockImplementation(async () => membership);

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [
                BankAccountInfoController,
                ClientController,
                VoucherPriceInfoController,
            ],
            providers: [
                TenantGuard,
                TenantContext,
                {
                    provide: PrismaService,
                    useValue: {
                        branch: { findUnique: branchFindUnique },
                        user_branch: { findFirst: membershipFindFirst },
                    },
                },
                { provide: BankAccountInfoService, useValue: bankAccountInfoService },
                { provide: ClientService, useValue: clientService },
                { provide: VoucherPriceInfoService, useValue: voucherPriceInfoService },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(testJwtGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it.each(["owner", "admin", "manager", "user"] as const)(
        "allows a valid %s tenant member on voucher, bank, and client access routes",
        async (role) => {
            setPrincipal(role);

            for (const route of ["voucher", "bank", "client"] as const) {
                await requestFor(route).expect((response) => {
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`${route} route returned ${response.status}`);
                    }
                });
            }

            expect(voucherPriceInfoService.list).toHaveBeenCalled();
            expect(bankAccountInfoService.findAll).toHaveBeenCalledWith(BRANCH_A);
            expect(clientService.create).toHaveBeenCalledWith(
                BRANCH_A,
                expect.objectContaining({ confirmedUnavailableEmployeeIds: [10] }),
            );
            if (role === "owner") {
                expect(branchFindUnique).toHaveBeenCalledWith({
                    where: { id: BRANCH_A },
                    select: { id: true, isActive: true },
                });
            } else {
                expect(membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
                    where: { userId: `${role}-user-id`, branchId: BRANCH_A },
                }));
            }
        },
    );

    it("denies anonymous requests on every newly member-accessible route", async () => {
        for (const route of ["voucher", "bank", "client"] as const) {
            await requestFor(route).expect(401);
        }

        expect(voucherPriceInfoService.list).not.toHaveBeenCalled();
        expect(bankAccountInfoService.findAll).not.toHaveBeenCalled();
        expect(clientService.create).not.toHaveBeenCalled();
    });

    it.each(["inactive membership", "missing membership"] as const)(
        "denies a tenant request with %s",
        async (caseName) => {
            setPrincipal("user");
            membership = caseName === "inactive membership"
                ? { role: "user", branch: { isActive: false } }
                : null;

            for (const route of ["voucher", "bank", "client"] as const) {
                await requestFor(route).expect(403);
            }

            expect(voucherPriceInfoService.list).not.toHaveBeenCalled();
            expect(bankAccountInfoService.findAll).not.toHaveBeenCalled();
            expect(clientService.create).not.toHaveBeenCalled();
        },
    );

    it("keeps bank and client reads pinned to the authenticated branch", async () => {
        setPrincipal("user", BRANCH_B);
        bankAccountInfoService.findAll.mockResolvedValue([{ area: "branch-b-area" }]);
        clientService.findAll.mockResolvedValue([{ id: 2, name: "Branch B client" }]);

        const bankResponse = await request(app.getHttpServer())
            .get("/bank-account-infos")
            .expect(200);
        const clientResponse = await request(app.getHttpServer())
            .get("/clients")
            .expect(200);

        expect(bankResponse.body).toEqual([{ area: "branch-b-area" }]);
        expect(clientResponse.body).toEqual([{ id: 2, name: "Branch B client" }]);
        expect(bankAccountInfoService.findAll).toHaveBeenCalledWith(BRANCH_B);
        expect(bankAccountInfoService.findAll).not.toHaveBeenCalledWith(BRANCH_A);
        expect(clientService.findAll).toHaveBeenCalledWith(BRANCH_B);
        expect(clientService.findAll).not.toHaveBeenCalledWith(BRANCH_A);
    });
});
