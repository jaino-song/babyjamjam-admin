import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";
import {
    AUTH_ERROR_CODES,
    type AuthErrorCode,
} from "../../application/constants/auth-error.constants";
import type { KakaoData } from "../../application/services/auth.service";

export const KAKAO_OAUTH_ERROR_REQUEST_KEY = "kakaoOAuthErrorCode";

export type KakaoCallbackRequest = Request & {
    [KAKAO_OAUTH_ERROR_REQUEST_KEY]?: AuthErrorCode;
    user?: KakaoData;
};

@Injectable()
export class KakaoAuthGuard extends AuthGuard("kakao") {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<KakaoCallbackRequest>();
        const providerError = request.query?.["error"];

        if (typeof providerError === "string") {
            request[KAKAO_OAUTH_ERROR_REQUEST_KEY] = providerError === "access_denied"
                ? AUTH_ERROR_CODES.OAUTH_CANCELLED
                : AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR;
            return true;
        }

        try {
            return Boolean(await super.canActivate(context));
        } catch {
            // Token exchange/profile failures happen inside Passport before the controller.
            // Let the controller validate the signed state + browser nonce before redirecting.
            request[KAKAO_OAUTH_ERROR_REQUEST_KEY] = AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR;
            return true;
        }
    }
}
