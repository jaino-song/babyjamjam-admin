import { ForbiddenException } from "@nestjs/common";

export class LegacyLoginNotAllowedError extends ForbiddenException {
    constructor() {
        super("LEGACY_LOGIN_NOT_ALLOWED");
    }
}
