import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AuthEmailTokenService } from "application/services/auth-email-token.service";
import { AuthService } from "application/services/auth.service";
import request from "supertest";

import { AppModule } from "../../app.module";

const PASSWORD = "Password1!";
const BRANCH_A = "20000000-0000-4000-8000-000000000001";
const ADMIN_A = "10000000-0000-4000-8000-000000000002";
const USER_A = "10000000-0000-4000-8000-000000000003";
const USER_B = "10000000-0000-4000-8000-000000000005";

describe("real auth and tenant lifecycle", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let jwt: JwtService;
    let emailTokens: AuthEmailTokenService;
    let authService: AuthService;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
        await app.init();
        prisma = app.get(PrismaService);
        jwt = app.get(JwtService);
        emailTokens = app.get(AuthEmailTokenService);
        authService = app.get(AuthService);
    });

    afterAll(async () => {
        await app.close();
    });

    async function login(email = "admin-a@auth-e2e.test") {
        const response = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ email, password: PASSWORD })
            .expect(201);
        expect(response.body.accessToken).toEqual(expect.any(String));
        expect(response.body.refreshToken).toMatch(
            /^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/i,
        );
        return response.body as { accessToken: string; refreshToken: string };
    }

    async function selectBranch(accessToken: string) {
        const response = await request(app.getHttpServer())
            .post("/auth/select-branch")
            .set("Authorization", `Bearer ${accessToken}`)
            .send({ branchId: BRANCH_A })
            .expect(201);
        return response.body as { accessToken: string; refreshToken: string };
    }

    it("hides cross-tenant users and only changes branch membership", async () => {
        const selected = await selectBranch((await login()).accessToken);

        await request(app.getHttpServer())
            .get(`/branches/${BRANCH_A}/users/${USER_A}`)
            .set("Authorization", `Bearer ${selected.accessToken}`)
            .expect(200);

        await request(app.getHttpServer())
            .get(`/branches/${BRANCH_A}/users/${USER_B}`)
            .set("Authorization", `Bearer ${selected.accessToken}`)
            .expect(404);

        await request(app.getHttpServer())
            .patch(`/branches/${BRANCH_A}/users/${USER_B}`)
            .set("Authorization", `Bearer ${selected.accessToken}`)
            .send({ branchRole: "user" })
            .expect(404);

        await request(app.getHttpServer())
            .delete(`/branches/${BRANCH_A}/users/${USER_B}`)
            .set("Authorization", `Bearer ${selected.accessToken}`)
            .expect(404);
    });

    it("allows exactly one concurrent refresh and rejects replay", async () => {
        const loginResult = await login();
        const attempts = await Promise.all([
            request(app.getHttpServer())
                .post("/auth/refresh-token")
                .send({ refreshToken: loginResult.refreshToken }),
            request(app.getHttpServer())
                .post("/auth/refresh-token")
                .send({ refreshToken: loginResult.refreshToken }),
        ]);
        expect(attempts.map((result) => result.status).sort()).toEqual([201, 401]);
    });

    it("uses fresh branch role on the next request after downgrade", async () => {
        const admin = await selectBranch((await login()).accessToken);
        const owner = await selectBranch((await login("owner@auth-e2e.test")).accessToken);

        await request(app.getHttpServer())
            .patch(`/branches/${BRANCH_A}/users/${ADMIN_A}`)
            .set("Authorization", `Bearer ${owner.accessToken}`)
            .send({ branchRole: "user" })
            .expect(200);

        await request(app.getHttpServer())
            .get(`/branches/${BRANCH_A}/users/${USER_A}`)
            .set("Authorization", `Bearer ${admin.accessToken}`)
            .expect(403);

        await request(app.getHttpServer())
            .patch(`/branches/${BRANCH_A}/users/${ADMIN_A}`)
            .set("Authorization", `Bearer ${owner.accessToken}`)
            .send({ branchRole: "admin" })
            .expect(200);
    });

    it("denies an existing access token immediately after membership removal", async () => {
        const admin = await selectBranch((await login()).accessToken);
        const owner = await selectBranch((await login("owner@auth-e2e.test")).accessToken);

        await request(app.getHttpServer())
            .delete(`/branches/${BRANCH_A}/users/${ADMIN_A}`)
            .set("Authorization", `Bearer ${owner.accessToken}`)
            .expect(200);

        await request(app.getHttpServer())
            .get(`/branches/${BRANCH_A}/users/${USER_A}`)
            .set("Authorization", `Bearer ${admin.accessToken}`)
            .expect(403);

        await prisma.user_branch.create({
            data: {
                userId: ADMIN_A,
                branchId: BRANCH_A,
                role: "admin",
            },
        });
    });

    it("revokes the current session on logout", async () => {
        const loginResult = await login();
        await request(app.getHttpServer())
            .post("/auth/logout")
            .set("Authorization", `Bearer ${loginResult.accessToken}`)
            .expect(201);
        await request(app.getHttpServer())
            .post("/auth/refresh-token")
            .send({ refreshToken: loginResult.refreshToken })
            .expect(401);
    });

    it("revokes by a signed expired access token", async () => {
        const loginResult = await login();
        const payload = jwt.decode<{
            sub: string;
            sid: string;
            role: string;
            tokenVersion: number;
            branchId?: string;
            branchRole?: string;
        }>(loginResult.accessToken)!;
        const expiredAccess = await jwt.signAsync(
            {
                sub: payload.sub,
                sid: payload.sid,
                role: payload.role,
                tokenVersion: payload.tokenVersion,
                branchId: payload.branchId,
                branchRole: payload.branchRole,
                type: "access",
            },
            { expiresIn: -1 },
        );

        await request(app.getHttpServer())
            .post("/auth/logout")
            .set("Authorization", `Bearer ${expiredAccess}`)
            .expect(201);
        await request(app.getHttpServer())
            .post("/auth/refresh-token")
            .send({ refreshToken: loginResult.refreshToken })
            .expect(401);
    });

    it("revokes every session on logout-all", async () => {
        const first = await login();
        const second = await login();

        await request(app.getHttpServer())
            .post("/auth/logout-all")
            .set("Authorization", `Bearer ${first.accessToken}`)
            .expect(201);

        await request(app.getHttpServer())
            .post("/auth/refresh-token")
            .send({ refreshToken: first.refreshToken })
            .expect(401);
        await request(app.getHttpServer())
            .post("/auth/refresh-token")
            .send({ refreshToken: second.refreshToken })
            .expect(401);
    });

    it("revokes active sessions when a password reset is consumed", async () => {
        const loginResult = await login("user-a@auth-e2e.test");
        const token = emailTokens.createToken();
        await prisma.auth_token.create({
            data: {
                id: token.tokenId,
                userId: USER_A,
                token: token.tokenHash,
                type: "password_reset",
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            },
        });

        await request(app.getHttpServer())
            .post("/auth/reset-password")
            .send({
                token: token.publicToken,
                newPassword: "ResetPassword2!",
            })
            .expect(201);

        await request(app.getHttpServer())
            .post("/auth/refresh-token")
            .send({ refreshToken: loginResult.refreshToken })
            .expect(401);
    });

    it("keeps one active refresh credential after concurrent branch rotation", async () => {
        const loginResult = await login();
        const payload = jwt.decode<{ sid: string }>(loginResult.accessToken)!;

        await Promise.all([
            request(app.getHttpServer())
                .post("/auth/select-branch")
                .set("Authorization", `Bearer ${loginResult.accessToken}`)
                .send({ branchId: BRANCH_A }),
            request(app.getHttpServer())
                .post("/auth/select-branch")
                .set("Authorization", `Bearer ${loginResult.accessToken}`)
                .send({ branchId: BRANCH_A }),
        ]);

        const activeTokens = await prisma.auth_refresh_token.count({
            where: {
                sessionId: payload.sid,
                usedAt: null,
                revokedAt: null,
                activeMarker: "active",
            },
        });
        expect(activeTokens).toBe(1);
    });

    it("consumes Kakao linking state once and rejects it after logout", async () => {
        const firstLogin = await login();
        const firstPayload = jwt.decode<{ sub: string; sid: string }>(
            firstLogin.accessToken,
        )!;
        const revokedState = await authService.createLinkingState(
            firstPayload.sub,
            firstPayload.sid,
        );
        await request(app.getHttpServer())
            .post("/auth/logout")
            .send({ refreshToken: firstLogin.refreshToken })
            .expect(201);
        await expect(authService.verifyLinkingState(revokedState)).resolves.toBeNull();

        const secondLogin = await login();
        const secondPayload = jwt.decode<{ sub: string; sid: string }>(
            secondLogin.accessToken,
        )!;
        const oneTimeState = await authService.createLinkingState(
            secondPayload.sub,
            secondPayload.sid,
        );
        await expect(authService.verifyLinkingState(oneTimeState)).resolves.toMatchObject({
            userId: secondPayload.sub,
            sessionId: secondPayload.sid,
        });
        await authService.linkKakaoToAccount(
            secondPayload.sub,
            {
                kakaoId: "auth-e2e-linked-kakao",
                email: "admin-a@auth-e2e.test",
                emailValid: true,
                emailVerified: true,
                name: "admin-a",
            },
            secondPayload.sid,
            oneTimeState,
        );
        await expect(authService.verifyLinkingState(oneTimeState)).resolves.toBeNull();
    });
});
