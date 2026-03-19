import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "../../application/services/auth.service";
import { AuthController } from "../../interface/controllers/auth.controller";
import { KakaoStrategy } from "./kakao.strategy";
import { LocalStrategy } from "./local.strategy";
import { DatabaseModule } from "../database/database.module";
import { RateLimitGuard } from "./rate-limit.guard";
import { ResendEmailAdapter } from "../adapters/resend-email.adapter";
import { SbAuthTokenRepository } from "../database/repositories/sb.auth-token.repository";
import { EMAIL_PORT } from "../../domain/ports/email.port";
import { AUTH_TOKEN_REPOSITORY } from "../../domain/repositories/auth-token.repository.interface";
import { getJwtSecret } from "./jwt-secret";

@Module({
    imports: [
        DatabaseModule,
        PassportModule,
        JwtModule.register({
            secret: getJwtSecret(),
            signOptions: { expiresIn: "7d" },
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        KakaoStrategy,
        LocalStrategy,
        RateLimitGuard,
        {
            provide: EMAIL_PORT,
            useClass: ResendEmailAdapter,
        },
        {
            provide: AUTH_TOKEN_REPOSITORY,
            useClass: SbAuthTokenRepository,
        },
    ],
    exports: [AuthService, RateLimitGuard, EMAIL_PORT],
})
export class AuthModule { }
