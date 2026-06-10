import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface CreatedIngestToken {
    id: string;
    branchId: string;
    label: string;
    /** Plaintext token — returned exactly once at creation, never stored. */
    token: string;
}

@Injectable()
export class CallIngestTokenService {
    private readonly logger = new Logger(CallIngestTokenService.name);

    constructor(private readonly prismaService: PrismaService) {}

    private hash(token: string): string {
        return createHash("sha256").update(token).digest("hex");
    }

    async createToken(branchId: string, label: string): Promise<CreatedIngestToken> {
        const token = `cit_${randomBytes(32).toString("base64url")}`;
        const record = await this.prismaService.call_ingest_token.create({
            data: { branchId, label, tokenHash: this.hash(token) },
        });
        return { id: record.id, branchId, label, token };
    }

    /** Returns the owning branchId for an active token, else null. */
    async resolveBranchId(token: string): Promise<string | null> {
        const record = await this.prismaService.call_ingest_token.findUnique({
            where: { tokenHash: this.hash(token) },
        });
        if (!record || !record.active) return null;

        this.prismaService.call_ingest_token
            .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
            .catch((error) => this.logger.warn(`Failed to touch lastUsedAt: ${error}`));

        return record.branchId;
    }

    async revoke(id: string): Promise<void> {
        await this.prismaService.call_ingest_token.update({
            where: { id },
            data: { active: false, revokedAt: new Date() },
        });
    }
}
