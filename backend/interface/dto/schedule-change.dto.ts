import { IsBoolean, IsDateString, IsOptional, IsString } from "class-validator";

export class ApplyScheduleChangeDto {
    @IsDateString({ strict: true })
    toDate!: string;

    /** The admin confirmed moving the session onto a weekend or holiday. */
    @IsOptional() @IsBoolean() allowNonBusinessDay?: boolean;
}

export class RejectScheduleChangeDto {
    @IsOptional() @IsString() reason?: string;
}
