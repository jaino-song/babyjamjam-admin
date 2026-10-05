import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { UserController } from "interface/controllers/user.controller";
import { BranchUserController } from "interface/controllers/branch-user.controller";
import { UserService } from "application/services/user.service";
import { UserEntity } from "domain/entities/user.entity";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";

describe("user response security (HTTP)", () => {
    let app: INestApplication;
    let role: string;
    const user = UserEntity.reconstitute("user-1", "private-kakao", "user@example.com", "User", null, "user", new Date("2026-01-01"), "private-hash", true, null, "both");
    const service = {
        create: jest.fn().mockResolvedValue(user),
        findByKakaoId: jest.fn().mockResolvedValue(user),
        findById: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue(user),
    };
    beforeEach(async () => {
        role = "owner";
        const module = await Test.createTestingModule({
            controllers: [UserController, BranchUserController],
            providers: [{ provide: UserService, useValue: service }],
        }).overrideGuard(JwtGuard).useValue({
            canActivate(context: ExecutionContext) {
                context.switchToHttp().getRequest().user = { userId: "actor", role, branchId: "branch-1" };
                return true;
            },
        }).overrideGuard(TenantGuard).useValue({
            canActivate(context: ExecutionContext) {
                context.switchToHttp().getRequest().tenant = { userId: "actor", globalRole: role, branchId: "branch-1", branchRole: "admin" };
                return true;
            },
        }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });
    afterEach(async () => { await app.close(); jest.clearAllMocks(); });

    const routes = [
        { method: "post", path: "/users", body: { kakaoId: "private-kakao" }, status: 201 },
        { method: "get", path: "/users/kakao?kakaoId=private-kakao", status: 200 },
        { method: "get", path: "/users/id?id=user-1", status: 200 },
        { method: "get", path: "/users/user-1", status: 200 },
        { method: "patch", path: "/users?id=user-1", body: { name: "User" }, status: 200 },
        { method: "patch", path: "/users/user-1", body: { name: "User" }, status: 200 },
        { method: "get", path: "/branches/branch-1/users/user-1", status: 200 },
        { method: "patch", path: "/branches/branch-1/users/user-1", body: { branchRole: "user" }, status: 200 },
    ] as const;
    it.each(routes)("omits credentials on $method $path", async (route) => {
        if (route.path.startsWith("/branches")) role = "admin";
        const response = await request(app.getHttpServer())[route.method](route.path)
            .send("body" in route ? route.body : undefined).expect(route.status);
        expect(response.body).toMatchObject({ id: "user-1", name: "User", authProvider: "both" });
        expect(response.body).not.toHaveProperty("passwordHash");
        expect(response.body).not.toHaveProperty("kakaoId");
        expect(user.passwordHash).toBe("private-hash");
        expect(user.kakaoId).toBe("private-kakao");
    });
    it.each(routes.slice(0, 2))("denies admin on $method $path", async (route) => {
        role = "admin";
        await request(app.getHttpServer())[route.method](route.path)
            .send("body" in route ? route.body : undefined).expect(403);
        expect(service.create).not.toHaveBeenCalled();
        expect(service.findByKakaoId).not.toHaveBeenCalled();
    });
    it("preserves null lookup responses", async () => {
        service.findByKakaoId.mockResolvedValueOnce(null);
        const response = await request(app.getHttpServer()).get("/users/kakao?kakaoId=missing").expect(200);
        expect(response.text).toBe("");
    });
});
