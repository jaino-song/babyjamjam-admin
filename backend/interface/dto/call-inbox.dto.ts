import { IsString, MaxLength } from "class-validator";

export class CreateCallIngestTokenDto {
    @IsString()
    @MaxLength(100)
    label!: string;
}
