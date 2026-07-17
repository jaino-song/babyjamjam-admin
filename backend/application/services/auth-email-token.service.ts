import { Injectable } from "@nestjs/common";
import { createHash, createHmac, randomUUID } from "crypto";

import { getJwtSecret } from "infrastructure/auth/jwt-secret";

@Injectable()
export class AuthEmailTokenService {
    createToken(): {
        tokenId: string;
        publicToken: string;
        tokenHash: string;
    } {
        const tokenId = randomUUID();
        const publicToken = this.publicTokenForId(tokenId);
        return {
            tokenId,
            publicToken,
            tokenHash: this.hashPublicToken(publicToken),
        };
    }

    publicTokenForId(tokenId: string): string {
        const signature = createHmac("sha256", this.hmacSecret())
            .update(tokenId)
            .digest("base64url");
        return `${tokenId}.${signature}`;
    }

    hashPublicToken(token: string): string {
        return createHash("sha256").update(token).digest("hex");
    }

    private hmacSecret(): string {
        return process.env["AUTH_EMAIL_TOKEN_HMAC_SECRET"] || getJwtSecret();
    }
}
