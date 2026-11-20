import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { AuthPhoneChallengeService } from "application/services/auth-phone-challenge.service";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { AUTH_PHONE_CHALLENGE_REPOSITORY } from "domain/repositories/auth-phone-challenge.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbAuthPhoneChallengeRepository } from "infrastructure/database/repositories/sb.auth-phone-challenge.repository";
import { AligoModule } from "module/aligo.module";

describe("AuthPhoneChallengeService — DI graph", () => {
    it("resolves the service with the real database and Aligo module providers without initializing them", async () => {
        // Compile only: .init() would run lifecycle hooks and connect to a database.
        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                DatabaseModule,
                AligoModule,
            ],
            providers: [
                { provide: AUTH_PHONE_CHALLENGE_REPOSITORY, useClass: SbAuthPhoneChallengeRepository },
                AuthPhoneChallengeService,
            ],
        }).compile();
        try {
            expect(moduleRef.get(AuthPhoneChallengeService)).toBeInstanceOf(AuthPhoneChallengeService);
            expect(moduleRef.get(AUTH_PHONE_CHALLENGE_REPOSITORY)).toBeInstanceOf(SbAuthPhoneChallengeRepository);
            expect(moduleRef.get(ALIGO_SMS_API_PORT)).toHaveProperty("sendSms", expect.any(Function));
        } finally {
            await moduleRef.close();
        }
    });
});
