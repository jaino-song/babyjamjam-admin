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
import { JwtStrategy } from "./jwt.strategy";
import { AuthSessionService } from "../../application/services/auth-session.service";
import { AuthEmailTokenService } from "../../application/services/auth-email-token.service";
import { AuthEmailOutboxService } from "../../application/services/auth-email-outbox.service";
import { SmtpEmailAdapter } from "../adapters/smtp-email.adapter";

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
        AuthSessionService,
        AuthEmailTokenService,
        AuthEmailOutboxService,
        KakaoStrategy,
        LocalStrategy,
        RateLimitGuard,
        JwtStrategy,
        {
            provide: EMAIL_PORT,
            useFactory: () => process.env["EMAIL_TRANSPORT"] === "smtp"
                ? new SmtpEmailAdapter()
                : new ResendEmailAdapter(),
        },
        {
            provide: AUTH_TOKEN_REPOSITORY,
            useClass: SbAuthTokenRepository,
        },
    ],
    exports: [AuthService, AuthSessionService, RateLimitGuard, EMAIL_PORT],
})
export class AuthModule { }
