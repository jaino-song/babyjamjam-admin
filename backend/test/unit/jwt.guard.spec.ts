import { ExecutionContext, SetMetadata, Type } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { IS_PUBLIC_KEY, Public } from "infrastructure/auth/public.decorator";

describe("JwtGuard", () => {
    @Public()
    class PublicController {
        handler() {}

        @SetMetadata(IS_PUBLIC_KEY, false)
        protectedHandler() {}
    }

    class Controller {
        @Public()
        publicHandler() {}

        protectedHandler() {}
    }

    const context = (controller: Type<unknown>, handler: Function) => ({
        getClass: () => controller,
        getHandler: () => handler,
    } as ExecutionContext);

    const guard = new JwtGuard(new Reflector());
    let passport: jest.SpyInstance;

    beforeEach(() => {
        passport = jest.spyOn(Object.getPrototypeOf(JwtGuard.prototype), "canActivate")
            .mockResolvedValue(true);
    });

    afterEach(() => jest.restoreAllMocks());

    it("allows a public handler without calling passport", () => {
        expect(guard.canActivate(context(Controller, Controller.prototype.publicHandler))).toBe(true);
        expect(passport).not.toHaveBeenCalled();
    });

    it("allows a public class without calling passport", () => {
        expect(guard.canActivate(context(PublicController, PublicController.prototype.handler))).toBe(true);
        expect(passport).not.toHaveBeenCalled();
    });

    it("defers to passport for a protected handler", async () => {
        const ctx = context(Controller, Controller.prototype.protectedHandler);
        passport.mockResolvedValue(false);
        await expect(guard.canActivate(ctx)).resolves.toBe(false);
        expect(passport).toHaveBeenCalledWith(ctx);
    });

    it("lets handler metadata override public class metadata", async () => {
        const ctx = context(PublicController, PublicController.prototype.protectedHandler);
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(passport).toHaveBeenCalledWith(ctx);
    });
});
