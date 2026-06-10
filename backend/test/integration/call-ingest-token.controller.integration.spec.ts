import { INestApplication, ExecutionContext, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { CallIngestTokenController } from "interface/controllers/call-ingest-token.controller";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";

describe("CallIngestTokenController (Integration)", () => {
    let app: INestApplication;
    let tokenService: jest.Mocked<Pick<CallIngestTokenService, "createToken" | "revoke">>;
    const tenantContext = { role: "owner", branchId: "branch-1", userId: "user-1", branchRole: "owner" };

    async function bootstrap(role: string) {
        tenantContext.role = role;
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [CallIngestTokenController],
            providers: [
                { provide: CallIngestTokenService, useValue: tokenService },
                { provide: TenantContext, useValue: tenantContext },
            ],
        })
            .overrideGuard(JwtGuard).useValue({ canActivate: () => true })
            .overrideGuard(TenantGuard).useValue({
                canActivate: (context: ExecutionContext) => {
                    const req = context.switchToHttp().getRequest();
                    req.user = { userId: "user-1", branchId: "branch-1", role };
                    return true;
                },
            })
            .compile();
        app = moduleFixture.createNestApplication();
        await app.init();
    }

    beforeEach(() => {
        tokenService = { createToken: jest.fn(), revoke: jest.fn() };
    });

    afterEach(async () => { await app?.close(); });

    it("owner can create a token and receives plaintext once", async () => {
        await bootstrap("owner");
        tokenService.createToken.mockResolvedValue({
            id: "tok-1", branchId: "branch-1", label: "인천본점 n8n", token: "cit_plain",
        });

        const response = await request(app.getHttpServer())
            .post("/branches/branch-1/call-ingest-tokens")
            .send({ label: "인천본점 n8n" });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ id: "tok-1", branchId: "branch-1", label: "인천본점 n8n", token: "cit_plain" });
    });

    it("non-owner gets 403", async () => {
        await bootstrap("member");
        const response = await request(app.getHttpServer())
            .post("/branches/branch-1/call-ingest-tokens")
            .send({ label: "x" });
        expect(response.status).toBe(403);
        expect(tokenService.createToken).not.toHaveBeenCalled();
    });

    it("owner can revoke", async () => {
        await bootstrap("owner");
        tokenService.revoke.mockResolvedValue(undefined);
        const response = await request(app.getHttpServer()).post("/call-ingest-tokens/tok-1/revoke");
        expect(response.status).toBe(200);
        expect(tokenService.revoke).toHaveBeenCalledWith("tok-1", "branch-1");
    });

    it("owner cannot create a token for another branch (403)", async () => {
        await bootstrap("owner");
        const response = await request(app.getHttpServer())
            .post("/branches/branch-OTHER/call-ingest-tokens")
            .send({ label: "x" });
        expect(response.status).toBe(403);
        expect(tokenService.createToken).not.toHaveBeenCalled();
    });

    it("revoke propagates 404 when service throws NotFoundException", async () => {
        await bootstrap("owner");
        tokenService.revoke.mockRejectedValue(new NotFoundException("Token not found"));
        const response = await request(app.getHttpServer()).post("/call-ingest-tokens/tok-1/revoke");
        expect(response.status).toBe(404);
    });
});
