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
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

type BranchRole = "owner" | "admin" | "manager" | "user";

type TestPrincipal = {
    userId: string;
    role: "owner" | "admin" | "user";
    branchId: string;
};

type Membership = {
    role: Exclude<BranchRole, "owner">;
    branch: { isActive: boolean };
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
    let membership: Membership | null;
    let bankAccountInfoService: {
        create: jest.Mock;
        findAll: jest.Mock;
        findByArea: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
    };
    let clientService: { create: jest.Mock };
    let voucherPriceInfoService: {
        list: jest.Mock;
        findByType: jest.Mock;
        getDistinctYears: jest.Mock;
        findById: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
        parseImage: jest.Mock;
        bulkUpdate: jest.Mock;
    };
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

    const setPrincipal = (
        role: BranchRole,
        branchId = BRANCH_A,
        activeMembership = true,
    ): void => {
        const globalRole = role === "owner" || role === "admin" ? role : "user";
        currentUser = {
            userId: `${role}-user-id`,
            role: globalRole,
            branchId,
        };
        membership = role === "owner"
            ? null
            : { role, branch: { isActive: activeMembership } };
    };

    const setMissingMembershipPrincipal = (): void => {
        setPrincipal("user");
        membership = null;
    };

    const voucherRead = (path: "list" | "type" | "years" | "id") => {
        const paths = {
            list: "/voucher-price-infos",
            type: "/voucher-price-infos/type",
            years: "/voucher-price-infos/years",
            id: "/voucher-price-infos/id",
        } as const;
        const requestBuilder = request(app.getHttpServer()).get(paths[path]);
        if (path === "type") return requestBuilder.query({ type: "standard" });
        if (path === "id") return requestBuilder.query({ id: "1" });
        return requestBuilder;
    };

    const bankRead = (path: "list" | "area") => {
        const requestBuilder = request(app.getHttpServer()).get(
            path === "list" ? "/bank-account-infos" : "/bank-account-infos/area",
        );
        return path === "area" ? requestBuilder.query({ area: "Seoul" }) : requestBuilder;
    };

    beforeEach(async () => {
        currentUser = undefined;
        membership = null;

        bankAccountInfoService = {
            create: jest.fn().mockResolvedValue({ area: "Seoul", bankName: "은행", accNum: "123" }),
            findAll: jest.fn().mockResolvedValue([]),
            findByArea: jest.fn().mockResolvedValue({ area: "Seoul", bankName: "은행", accNum: "123" }),
            update: jest.fn().mockResolvedValue({ area: "Seoul", bankName: "은행", accNum: "123" }),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        clientService = {
            create: jest.fn().mockResolvedValue({ id: 1, name: activationBody.name }),
        };
        voucherPriceInfoService = {
            list: jest.fn().mockResolvedValue([]),
            findByType: jest.fn().mockResolvedValue([]),
            getDistinctYears: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 1 }),
            update: jest.fn().mockResolvedValue({ id: 1 }),
            delete: jest.fn().mockResolvedValue(undefined),
            parseImage: jest.fn().mockResolvedValue({}),
            bulkUpdate: jest.fn().mockResolvedValue({}),
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
                OwnerOrAdminGuard,
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
        "allows an active %s principal on all voucher reads",
        async (role) => {
            setPrincipal(role);

            for (const path of ["list", "type", "years", "id"] as const) {
                await voucherRead(path).expect(200);
            }
        },
    );

    it("denies anonymous voucher and bank reads", async () => {
        for (const path of ["list", "type", "years", "id"] as const) {
            await voucherRead(path).expect(401);
        }
        await bankRead("list").expect(401);
        await bankRead("area").expect(401);
    });

    it("denies voucher and bank reads for missing or inactive membership", async () => {
        setMissingMembershipPrincipal();
        for (const path of ["list", "type", "years", "id"] as const) {
            await voucherRead(path).expect(403);
        }
        await bankRead("list").expect(403);
        await bankRead("area").expect(403);

        setPrincipal("manager", BRANCH_A, false);
        for (const path of ["list", "type", "years", "id"] as const) {
            await voucherRead(path).expect(403);
        }
        await bankRead("list").expect(403);
        await bankRead("area").expect(403);
    });

    it.each(["owner", "admin", "manager", "user"] as const)(
        "allows %s bank reads and pins the branch",
        async (role) => {
            setPrincipal(role, BRANCH_B);
            bankAccountInfoService.findAll.mockResolvedValue([{ area: "branch-b-area" }]);
            bankAccountInfoService.findByArea.mockResolvedValue({ area: "branch-b-area" });

            const listResponse = await bankRead("list").expect(200);
            const areaResponse = await bankRead("area").expect(200);

            expect(listResponse.body).toEqual([{ area: "branch-b-area" }]);
            expect(areaResponse.body).toEqual({ area: "branch-b-area" });
            expect(bankAccountInfoService.findAll).toHaveBeenCalledWith(BRANCH_B);
            expect(bankAccountInfoService.findAll).not.toHaveBeenCalledWith(BRANCH_A);
            expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith("Seoul", BRANCH_B);
            expect(bankAccountInfoService.findByArea).not.toHaveBeenCalledWith("Seoul", BRANCH_A);
        },
    );

    const protectedRoutes = [
        {
            name: "voucher create",
            invoke: () => request(app.getHttpServer()).post("/voucher-price-infos").send({
                type: "standard",
                duration: "30",
                fullPrice: "1000000",
                grant: "500000",
                actualPrice: "500000",
                year: 2026,
            }),
        },
        {
            name: "voucher update",
            invoke: () => request(app.getHttpServer()).patch("/voucher-price-infos").query({ id: "1" }).send({ type: "standard" }),
        },
        {
            name: "voucher delete",
            invoke: () => request(app.getHttpServer()).delete("/voucher-price-infos").query({ id: "1" }),
        },
        {
            name: "voucher parse image",
            invoke: () => request(app.getHttpServer()).post("/voucher-price-infos/parse-image").attach("image", Buffer.from("image"), "image.png"),
        },
        {
            name: "voucher bulk update",
            invoke: () => request(app.getHttpServer()).post("/voucher-price-infos/bulk-update").send({ items: [], year: 2026 }),
        },
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
            name: "client employee activation",
            invoke: () => request(app.getHttpServer()).post("/clients/with-employee-activation").send(activationBody),
        },
    ] as const;

    it.each(protectedRoutes)("allows owner on $name", async ({ invoke }) => {
        setPrincipal("owner");
        const response = await invoke();
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(300);
    });

    it.each(protectedRoutes)("allows global admin on $name", async ({ invoke }) => {
        setPrincipal("admin");
        const response = await invoke();
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(300);
    });

    it.each(protectedRoutes)("denies branch manager on $name", async ({ invoke }) => {
        setPrincipal("manager");
        const response = await invoke();
        expect(response.status).toBe(403);
    });

    it.each(protectedRoutes)("denies branch user on $name", async ({ invoke }) => {
        setPrincipal("user");
        const response = await invoke();
        expect(response.status).toBe(403);
    });
});
