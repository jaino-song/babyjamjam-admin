import { IsString, IsNotEmpty } from "class-validator";

export class TokenExchangeDto {
    @IsString()
    @IsNotEmpty()
    code!: string;
}
