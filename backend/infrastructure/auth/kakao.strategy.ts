import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-kakao";
import { KakaoData } from "../../application/services/auth.service";
import { getKakaoOAuthConfig } from "./kakao-config";

interface KakaoProfile {
    id: string;
    username: string;
    email: string;
    profileImage: string;
    _json: {
        kakao_account: {
            email: string;
            is_email_valid?: boolean;
            is_email_verified?: boolean;
        };
        properties: {
            profile_image: string;
        };
    };
}

@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy) {
    constructor() {
        const kakaoOAuthConfig = getKakaoOAuthConfig();

        super({
            // Keep Kakao login limited to basic profile/email fields for now.
            // Requesting additional consent items such as phone_number or birthday
            // should only be done after the Kakao app has the required approval.
            clientID: kakaoOAuthConfig.clientID,
            clientSecret: kakaoOAuthConfig.clientSecret,
            callbackURL: kakaoOAuthConfig.callbackURL,
        });
    }

    async validate(accessToken: string, refreshToken: string, profile: KakaoProfile) {
        return {
            kakaoId: profile.id.toString(),
            name: profile.username,
            email: profile._json.kakao_account.email,
            emailValid: profile._json.kakao_account.is_email_valid === true,
            emailVerified: profile._json.kakao_account.is_email_verified === true,
            profileImage: profile._json.properties.profile_image,
        } as KakaoData;
    }
}
