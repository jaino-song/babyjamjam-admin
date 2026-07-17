import { IsDateString, IsOptional, IsString } from "class-validator";

export class ApplyScheduleChangeDto {
    @IsDateString({ strict: true })
    toDate!: string;
}

export class RejectScheduleChangeDto {
    @IsOptional() @IsString() reason?: string;
}
