import { Injectable } from "@nestjs/common";
import { IAuthTokenRepository } from "domain/repositories/auth-token.repository.interface";
import { AuthTokenEntity, AuthTokenType } from "domain/entities/auth-token.entity";
import { PrismaService } from "../prisma.service";
import { AuthTokenMapper } from "../mapper/auth-token.mapper";

@Injectable()
export class SbAuthTokenRepository implements IAuthTokenRepository {
    constructor(private prismaService: PrismaService) {}

    async findByToken(hashedToken: string): Promise<AuthTokenEntity | null> {
        const token = await this.prismaService.auth_token.findUnique({
            where: { token: hashedToken },
        });
        return token ? AuthTokenMapper.toDomain(token) : null;
    }

    async findByUserIdAndType(
        userId: string,
        type: AuthTokenType,
    ): Promise<AuthTokenEntity[]> {
        const tokens = await this.prismaService.auth_token.findMany({
            where: {
                userId: userId,
                type: type,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        return tokens.map(AuthTokenMapper.toDomain);
    }

    async create(token: AuthTokenEntity): Promise<AuthTokenEntity> {
        const created = await this.prismaService.auth_token.create({
            data: AuthTokenMapper.toPrismaCreate(token),
        });
        return AuthTokenMapper.toDomain(created);
    }

    async update(token: AuthTokenEntity): Promise<AuthTokenEntity> {
        const updated = await this.prismaService.auth_token.update({
            where: { id: token.id },
            data: AuthTokenMapper.toPrismaUpdate(token),
        });
        return AuthTokenMapper.toDomain(updated);
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.auth_token.delete({
            where: { id },
        });
    }

    async deleteByUserIdAndType(
        userId: string,
        type: AuthTokenType,
    ): Promise<void> {
        await this.prismaService.auth_token.deleteMany({
            where: {
                userId: userId,
                type: type,
            },
        });
    }

    async deleteExpiredTokens(): Promise<number> {
        const result = await this.prismaService.auth_token.deleteMany({
            where: {
                expiresAt: {
                    lt: new Date(),
                },
            },
        });
        return result.count;
    }
}
