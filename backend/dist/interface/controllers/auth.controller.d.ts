import { Response } from "express";
import { AuthService } from "../../application/services/auth.service";
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    kakaoLogin(): Promise<void>;
    kakaoCallback(req: any, res: Response): Promise<void>;
}
