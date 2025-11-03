import { Controller, Get, Req, Res, UseGuards, Request } from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { AuthService, KakaoData } from "../../application/services/auth.service";
import { UserValidationResult } from "../../application/services/auth.service";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Get("kakao")
    @UseGuards(AuthGuard("kakao"))
    async kakaoLogin() {
        // Redirects user to Kakao login page
    }

    @Get("kakao/callback")
    @UseGuards(AuthGuard("kakao"))
    async kakaoCallback(@Req() req: any, @Res() res: Response) {
        const result: UserValidationResult = await this.authService.validateKakaoUser(req.user);
        
        // Set HTTP-only cookie
        res.cookie("auth_token", result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
        
        // Redirect to frontend
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        res.redirect(frontendUrl);
    }
}