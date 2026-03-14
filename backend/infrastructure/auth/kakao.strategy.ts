import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-kakao";
import { KakaoData } from "../../application/services/auth.service";

interface KakaoProfile {
    id: string;
    username: string;
    email: string;
    profileImage: string;
    _json: {
        kakao_account: {
            email: string;
        };
        properties: {
            profile_image: string;
        };
    };
}

@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy) {
    constructor() {
        super({
            // Keep Kakao login limited to basic profile/email fields for now.
            // Requesting additional consent items such as phone_number or birthday
            // should only be done after the Kakao app has the required approval.
            clientID: process.env['KAKAO_CLIENT_ID'],
            clientSecret: process.env['KAKAO_CLIENT_SECRET'],
            callbackURL: process.env['KAKAO_CALLBACK_URL'],
        });
    }

    async validate(accessToken: string, refreshToken: string, profile: KakaoProfile) {
        return {
            kakaoId: profile.id.toString(),
            name: profile.username,
            email: profile._json.kakao_account.email,
            profileImage: profile._json.properties.profile_image,
        } as KakaoData;
    }
}
