import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";

function contextWithAuth(header?: string): ExecutionContext {
    const request: Record<string, unknown> = { headers: header ? { authorization: header } : {} };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        __request: request,
    } as unknown as ExecutionContext & { __request: Record<string, unknown> };
}

describe("CallIngestGuard", () => {
    let tokenService: jest.Mocked<Pick<CallIngestTokenService, "resolveBranchId">>;
    let guard: CallIngestGuard;

    beforeEach(() => {
        tokenService = { resolveBranchId: jest.fn() };
        guard = new CallIngestGuard(tokenService as unknown as CallIngestTokenService);
    });

    it("attaches branchId from a valid token", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        const context = contextWithAuth("Bearer cit_valid");

        await expect(guard.canActivate(context)).resolves.toBe(true);
        const request = (context as unknown as { __request: { callIngestBranchId?: string } }).__request;
        expect(request.callIngestBranchId).toBe("branch-1");
    });

    it("rejects missing header, malformed header, and unknown token", async () => {
        await expect(guard.canActivate(contextWithAuth())).rejects.toThrow(UnauthorizedException);
        await expect(guard.canActivate(contextWithAuth("Token abc"))).rejects.toThrow(UnauthorizedException);

        tokenService.resolveBranchId.mockResolvedValue(null);
        await expect(guard.canActivate(contextWithAuth("Bearer cit_bad"))).rejects.toThrow(UnauthorizedException);
    });
});
