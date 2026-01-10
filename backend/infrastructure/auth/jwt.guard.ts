import { Injectable, ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

// Preview 환경에서 사용할 Mock User 정보
const PREVIEW_MOCK_USER = {
    userId: 'preview-user',
    role: 'owner',
};

@Injectable()
export class JwtGuard extends AuthGuard("jwt") {
    constructor() {
        super();
    }

    canActivate(context: ExecutionContext) {
        // Vercel Preview 환경에서는 인증을 bypass
        if (process.env['NODE_ENV'] === 'preview') {
            const request = context.switchToHttp().getRequest();
            request.user = PREVIEW_MOCK_USER;
            return true;
        }

        return super.canActivate(context);
    }
}