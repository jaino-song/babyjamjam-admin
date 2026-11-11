import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AuthService } from "application/services/auth.service";
import { EmployeeService } from "application/services/employee.service";
import { UserService } from "application/services/user.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { JwtStrategy } from "infrastructure/auth/jwt.strategy";
import { IS_PUBLIC_KEY } from "infrastructure/auth/public.decorator";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AuthController } from "interface/controllers/auth.controller";
import { EmployeeController } from "interface/controllers/employee.controller";
import { UserController } from "interface/controllers/user.controller";
import { AppModule } from "../../app.module";

// The existing Jest mapper omits module/*; resolve those imports locally so
// metadata is checked on the real AppModule without compiling it or changing config.
jest.mock("module/bank-account-info.module", () => jest.requireActual("../../module/bank-account-info.module"), { virtual: true });
jest.mock("module/user.module", () => jest.requireActual("../../module/user.module"), { virtual: true });
jest.mock("module/message.module", () => jest.requireActual("../../module/message.module"), { virtual: true });
jest.mock("module/voucher-price-info.module", () => jest.requireActual("../../module/voucher-price-info.module"), { virtual: true });
jest.mock("module/employee.module", () => jest.requireActual("../../module/employee.module"), { virtual: true });
jest.mock("module/client.module", () => jest.requireActual("../../module/client.module"), { virtual: true });
jest.mock("module/employee-schedule.module", () => jest.requireActual("../../module/employee-schedule.module"), { virtual: true });
jest.mock("module/eformsign-doc.module", () => jest.requireActual("../../module/eformsign-doc.module"), { virtual: true });
jest.mock("module/area-template.module", () => jest.requireActual("../../module/area-template.module"), { virtual: true });

describe("Global authentication", () => {
    let app: INestApplication;
    let jwt: JwtService;
    let dbUser: { id: string; role: string | null } | null;
    const originalSecret = process.env['JWT_SECRET'];
    const prisma = { user: { findUnique: jest.fn(async () => dbUser) } };
    const employees = { findAll: jest.fn().mockResolvedValue([]) };
    const users = {
        create: jest.fn().mockResolvedValue({ id: "created-id" }),
        update: jest.fn().mockResolvedValue({ id: "x" }),
        delete: jest.fn().mockResolvedValue({ id: "x" }),
    };
    const auth = { exchangeCodeForTokens: jest.fn().mockResolvedValue({ exchanged: true }) };
    const token = (type = "access", role = "owner") => jwt.sign({ sub: "staff-id", role, type });

    beforeAll(async () => {
        process.env['JWT_SECRET'] = "test-secret";
        const module = await Test.createTestingModule({
            imports: [PassportModule, JwtModule.register({ secret: "test-secret" })],
            controllers: [EmployeeController, UserController, AuthController],
            providers: [
                JwtStrategy,
                { provide: EmployeeService, useValue: employees },
                { provide: UserService, useValue: users },
                { provide: AuthService, useValue: auth },
                { provide: PrismaService, useValue: prisma },
                { provide: APP_GUARD, useClass: JwtGuard },
            ],
        }).compile();
        app = module.createNestApplication();
        app.use(cookieParser());
        await app.init();
        jwt = module.get(JwtService);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        dbUser = { id: "staff-id", role: "manager" };
    });

    afterAll(async () => {
        if (app) await app.close();
        if (originalSecret === undefined) delete process.env['JWT_SECRET'];
        else process.env['JWT_SECRET'] = originalSecret;
    });

    it("registers JwtGuard globally on the real AppModule", () => {
        expect(Reflect.getMetadata("providers", AppModule)).toContainEqual({
            provide: APP_GUARD, useClass: JwtGuard,
        });
    });

    it("marks exactly the three authentication entry handlers public", () => {
        const publicHandlers = ["kakaoLogin", "kakaoCallback", "exchangeToken"] as const;
        for (const name of publicHandlers) {
            expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype[name])).toBe(true);
        }
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController.prototype.getCurrentUser)).toBeUndefined();
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController)).toBeUndefined();
    });

    it("rejects anonymous employee access", async () => {
        await request(app.getHttpServer()).get("/employees").expect(401);
        expect(employees.findAll).not.toHaveBeenCalled();
    });

    it("accepts a manager's bearer access token", async () => {
        await request(app.getHttpServer()).get("/employees")
            .set("Authorization", `Bearer ${token()}`).expect(200).expect([]);
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
            where: { id: "staff-id" }, select: { id: true, role: true },
        });
    });

    it("accepts the same access token from the auth_token cookie", async () => {
        const accessToken = token();
        await request(app.getHttpServer()).get("/employees")
            .set("Authorization", `Bearer ${accessToken}`).expect(200);
        await request(app.getHttpServer()).get("/employees")
            .set("Cookie", `auth_token=${accessToken}`).expect(200);
    });

    it.each(["user", null])("rejects DB role %s despite the owner token claim", async (role) => {
        dbUser = { id: "staff-id", role };
        await request(app.getHttpServer()).get("/employees")
            .set("Authorization", `Bearer ${token()}`).expect(401);
        expect(employees.findAll).not.toHaveBeenCalled();
    });

    it("rejects a deleted user", async () => {
        dbUser = null;
        await request(app.getHttpServer()).get("/employees")
            .set("Authorization", `Bearer ${token()}`).expect(401);
    });

    it("rejects refresh tokens", async () => {
        await request(app.getHttpServer()).get("/employees")
            .set("Authorization", `Bearer ${token("refresh")}`).expect(401);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("rejects a token signed with another secret", async () => {
        const invalidToken = jwt.sign({ sub: "staff-id", role: "owner", type: "access" }, { secret: "wrong-test-secret" });
        await request(app.getHttpServer()).get("/employees")
            .set("Authorization", `Bearer ${invalidToken}`).expect(401);
    });

    it("rejects an expired token", async () => {
        const expiredToken = jwt.sign({ sub: "staff-id", role: "owner", type: "access" }, { expiresIn: -1 });
        await request(app.getHttpServer()).get("/employees")
            .set("Authorization", `Bearer ${expiredToken}`).expect(401);
    });

    it.each(["manager", "admin"])("blocks all user mutations by a DB %s with an owner claim", async (role) => {
        dbUser = { id: "staff-id", role };
        const authorization = `Bearer ${token("access", "owner")}`;
        await request(app.getHttpServer()).post("/users").set("Authorization", authorization)
            .send({ kakaoId: "new-id" }).expect(403);
        await request(app.getHttpServer()).patch("/users?id=x").set("Authorization", authorization)
            .send({ name: "Updated" }).expect(403);
        await request(app.getHttpServer()).delete("/users?id=x").set("Authorization", authorization).expect(403);
        expect(users.create).not.toHaveBeenCalled();
        expect(users.update).not.toHaveBeenCalled();
        expect(users.delete).not.toHaveBeenCalled();
    });

    it("allows all user mutations by a DB owner despite a user token claim", async () => {
        dbUser = { id: "staff-id", role: "owner" };
        const authorization = `Bearer ${token("access", "user")}`;
        await request(app.getHttpServer()).post("/users").set("Authorization", authorization)
            .send({ kakaoId: "new-id" }).expect(201);
        await request(app.getHttpServer()).patch("/users?id=x").set("Authorization", authorization)
            .send({ name: "Updated" }).expect(200);
        await request(app.getHttpServer()).delete("/users?id=x").set("Authorization", authorization).expect(200);
        expect(users.create).toHaveBeenCalledWith({ kakaoId: "new-id" });
        expect(users.update).toHaveBeenCalledWith("x", expect.objectContaining({ name: "Updated" }));
        expect(users.delete).toHaveBeenCalledWith("x");
    });

    it("keeps auth/me protected", async () => {
        await request(app.getHttpServer()).get("/auth/me").expect(401);
    });

    it("lets anonymous auth/token requests reach the exchange handler", async () => {
        await request(app.getHttpServer()).post("/auth/token").send({ code: "test-code" })
            .expect(201).expect({ exchanged: true });
        expect(auth.exchangeCodeForTokens).toHaveBeenCalledWith("test-code");
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
});
