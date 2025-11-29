import { Response } from "express";
import { AuthService } from "../../application/services/auth.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { TokenExchangeDto } from "interface/dto/token-exchange.dto";
export declare class AuthController {
    private readonly authService;
    private readonly prisma;
    constructor(authService: AuthService, prisma: PrismaService);
    kakaoLogin(): Promise<void>;
    kakaoCallback(req: any, res: Response): Promise<void>;
    getCurrentUser(req: any): Promise<{
        id: string;
        email: string;
        name: string;
        profile_image: string;
        role: string;
    }>;
    exchangeToken(body: TokenExchangeDto): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
}
