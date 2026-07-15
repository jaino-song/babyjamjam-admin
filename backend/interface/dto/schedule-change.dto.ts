import { IsOptional, IsString } from "class-validator";

export class RejectScheduleChangeDto {
    @IsOptional() @IsString() reason?: string;
}
