import { Injectable, ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

// Development/Preview 환경에서 사용할 Mock User 정보
const DEV_MOCK_USER = {
    userId: 'dev-user',
    role: 'owner',
};

@Injectable()
export class JwtGuard extends AuthGuard("jwt") {
    constructor() {
        super();
    }

    canActivate(context: ExecutionContext) {
        // Development 또는 Vercel Preview 환경에서는 인증을 bypass
        if (process.env['NODE_ENV'] === 'development' || process.env['VERCEL_ENV'] === 'preview') {
            const request = context.switchToHttp().getRequest();
            request.user = DEV_MOCK_USER;
            return true;
        }

        return super.canActivate(context);
    }
}