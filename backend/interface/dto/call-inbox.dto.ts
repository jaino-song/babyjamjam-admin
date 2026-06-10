import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateCallIngestTokenDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    label!: string;
}
