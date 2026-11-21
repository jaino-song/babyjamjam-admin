import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class CompleteAccountOnboardingDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: "전화번호는 필수입니다." })
    @Matches(/^01[016789]-?\d{3,4}-?\d{4}$/, { message: "유효한 전화번호를 입력해주세요." })
    phone?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: "생년월일은 필수입니다." })
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "유효한 생년월일을 입력해주세요. (예: 1990-01-01)" })
    birthDate?: string;
}
