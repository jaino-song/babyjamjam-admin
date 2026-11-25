import { IsString, Length, Matches } from "class-validator";

export class VerifyAccountLinkDto {
    @IsString()
    @Length(64, 64)
    @Matches(/^[0-9a-f]{64}$/)
    challengeToken!: string;

    @IsString()
    @Length(6, 6)
    @Matches(/^\d{6}$/)
    code!: string;
}
