import { Strategy } from "passport-jwt";
interface JwtPayload {
    sub: string;
    role: string;
    type: 'access' | 'refresh';
}
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    constructor();
    validate(payload: JwtPayload): Promise<{
        userId: string;
        role: string;
    }>;
}
export {};
