import type { ExecutionContext } from "@nestjs/common";

import {
    KakaoAuthGuard,
    KAKAO_OAUTH_ERROR_REQUEST_KEY,
} from "../../infrastructure/auth/kakao-auth.guard";

function createContext(query: Record<string, string>): ExecutionContext {
    const request = { query };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
}

describe("KakaoAuthGuard", () => {
    it("passes Kakao cancellation to the controller as a stable error code", async () => {
        const context = createContext({ error: "access_denied" });
        const request = context.switchToHttp().getRequest();

        await expect(new KakaoAuthGuard().canActivate(context)).resolves.toBe(true);
        expect(request[KAKAO_OAUTH_ERROR_REQUEST_KEY]).toBe("OAUTH_CANCELLED");
    });

    it("does not expose arbitrary provider error values", async () => {
        const context = createContext({ error: "provider_internal_detail" });
        const request = context.switchToHttp().getRequest();

        await expect(new KakaoAuthGuard().canActivate(context)).resolves.toBe(true);
        expect(request[KAKAO_OAUTH_ERROR_REQUEST_KEY]).toBe("OAUTH_PROVIDER_ERROR");
    });
});
