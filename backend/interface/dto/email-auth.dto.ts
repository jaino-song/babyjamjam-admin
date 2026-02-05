import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
    @IsEmail({}, { message: '유효한 이메일 주소를 입력해주세요.' })
    @IsNotEmpty({ message: '이메일은 필수입니다.' })
    email!: string;

    @IsString()
    @IsNotEmpty({ message: '비밀번호는 필수입니다.' })
    @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
    password!: string;

    @IsString()
    @IsNotEmpty({ message: '이름은 필수입니다.' })
    name!: string;
}

export class LoginDto {
    @IsEmail({}, { message: '유효한 이메일 주소를 입력해주세요.' })
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
    @IsEmail({}, { message: '유효한 이메일 주소를 입력해주세요.' })
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
    newPassword!: string;
}

export class ResendVerificationDto {
    @IsEmail({}, { message: '유효한 이메일 주소를 입력해주세요.' })
    @IsNotEmpty({ message: '이메일은 필수입니다.' })
    email!: string;
}

export class LinkPasswordDto {
    @IsString()
    @IsNotEmpty({ message: '비밀번호는 필수입니다.' })
    @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
    password!: string;
}
