import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsString, IsUUID, Matches, MinLength } from 'class-validator';

const NAME_PATTERN = /^[\p{L} ]+$/u;

export class RegisterDto {
    @IsEmail({}, { message: '이메일 주소를 확인해 주세요.' })
    @IsNotEmpty({ message: '이메일은 필수입니다.' })
    email!: string;

    @IsString()
    @IsNotEmpty({ message: '비밀번호는 필수입니다.' })
    @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
    @Matches(/[A-Z]/, { message: '비밀번호에 대문자가 포함되어야 합니다.' })
    @Matches(/[a-z]/, { message: '비밀번호에 소문자가 포함되어야 합니다.' })
    @Matches(/[0-9]/, { message: '비밀번호에 숫자가 포함되어야 합니다.' })
    @Matches(/[^A-Za-z0-9]/, { message: '비밀번호에 특수문자가 포함되어야 합니다.' })
    password!: string;

    @IsString()
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @IsNotEmpty({ message: '이름은 필수입니다.' })
    @Matches(NAME_PATTERN, { message: '이름에는 숫자나 특수문자를 입력할 수 없습니다.' })
    name!: string;

    @IsString()
    @IsNotEmpty({ message: '전화번호는 필수입니다.' })
    @Matches(/^01[016789]-?\d{3,4}-?\d{4}$/, { message: '유효한 전화번호를 입력해주세요.' })
    phone!: string;

    @IsString()
    @IsNotEmpty({ message: '생년월일은 필수입니다.' })
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '유효한 생년월일을 입력해주세요. (예: 1990-01-01)' })
    birthDate!: string;

    @IsUUID('4', { message: '유효한 지점을 선택해주세요.' })
    @IsNotEmpty({ message: '지점을 선택해주세요.' })
    branchId!: string;

    @IsString()
    @IsNotEmpty({ message: '역할을 선택해주세요.' })
    @IsIn(['admin', 'manager', 'user'], { message: '유효한 역할을 선택해주세요.' })
    role!: string;
}

export class LoginDto {
    @IsEmail({}, { message: '이메일 주소를 확인해 주세요.' })
    @IsNotEmpty({ message: '이메일은 필수입니다.' })
    email!: string;

    @IsString()
    @IsNotEmpty({ message: '비밀번호는 필수입니다.' })
    password!: string;
}

export class VerifyEmailDto {
    @IsString()
    @IsNotEmpty({ message: '인증 토큰은 필수입니다.' })
    token!: string;
}

export class ForgotPasswordDto {
    @IsEmail({}, { message: '이메일 주소를 확인해 주세요.' })
    @IsNotEmpty({ message: '이메일은 필수입니다.' })
    email!: string;
}

export class ResetPasswordDto {
    @IsString()
    @IsNotEmpty({ message: '토큰은 필수입니다.' })
    token!: string;

    @IsString()
    @IsNotEmpty({ message: '새 비밀번호는 필수입니다.' })
    @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
    @Matches(/[A-Z]/, { message: '비밀번호에 대문자가 포함되어야 합니다.' })
    @Matches(/[a-z]/, { message: '비밀번호에 소문자가 포함되어야 합니다.' })
    @Matches(/[0-9]/, { message: '비밀번호에 숫자가 포함되어야 합니다.' })
    @Matches(/[^A-Za-z0-9]/, { message: '비밀번호에 특수문자가 포함되어야 합니다.' })
    newPassword!: string;
}

export class ResendVerificationDto {
    @IsEmail({}, { message: '이메일 주소를 확인해 주세요.' })
    @IsNotEmpty({ message: '이메일은 필수입니다.' })
    email!: string;
}

export class LinkPasswordDto {
    @IsString()
    @IsNotEmpty({ message: '비밀번호는 필수입니다.' })
    @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
    @Matches(/[A-Z]/, { message: '비밀번호에 대문자가 포함되어야 합니다.' })
    @Matches(/[a-z]/, { message: '비밀번호에 소문자가 포함되어야 합니다.' })
    @Matches(/[0-9]/, { message: '비밀번호에 숫자가 포함되어야 합니다.' })
    @Matches(/[^A-Za-z0-9]/, { message: '비밀번호에 특수문자가 포함되어야 합니다.' })
    password!: string;
}
