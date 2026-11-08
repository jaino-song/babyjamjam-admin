import { ExecutionContext, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { EformsignBackupTokenGuard } from "./eformsign-backup-token.guard";

const context = (authorization?: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
}) as unknown as ExecutionContext;

describe("EformsignBackupTokenGuard", () => {
    let value: string | undefined;
    const get = jest.fn(() => value);
    const guard = new EformsignBackupTokenGuard({ get } as unknown as ConfigService);
    beforeEach(() => { value = "secret"; get.mockClear(); });

    it.each([undefined, "   "])("returns 404 when env is %p, before checking headers", (env) => {
        value = env;
        expect(() => guard.canActivate(context())).toThrow(NotFoundException);
    });
    it.each([undefined, "Basic x", "Bearer ", "Bearer wrong!", "Bearer short"])("returns 401 for %p", (header) => {
        expect(() => guard.canActivate(context(header))).toThrow(UnauthorizedException);
    });
    it("allows the trimmed configured token", () => {
        value = " secret ";
        expect(guard.canActivate(context("Bearer secret"))).toBe(true);
        expect(get).toHaveBeenCalledWith("EFORMSIGN_BACKUP_TOKEN");
    });
    it("reads env again for each request", () => {
        expect(guard.canActivate(context("Bearer secret"))).toBe(true);
        value = "changed";
        expect(() => guard.canActivate(context("Bearer secret"))).toThrow(UnauthorizedException);
        value = undefined;
        expect(() => guard.canActivate(context("Bearer changed"))).toThrow(NotFoundException);
        expect(get).toHaveBeenCalledTimes(3);
    });
});
