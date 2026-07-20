import { z } from 'zod';
import {
    authBirthDateSchema,
    authEmailSchema,
    authPasswordSchema,
    authPhoneSchema,
    registerFormSchema,
    type RegisterFormData,
} from '@babyjamjam/shared';

const EMAIL_FORMAT_MESSAGE = '이메일 주소를 확인해 주세요.';

// Password validation with detailed requirements
const passwordSchema = authPasswordSchema;

// Phone number validation (Korean format)
const phoneSchema = authPhoneSchema;

// Birth date validation (YYYY-MM-DD)
const birthDateSchema = authBirthDateSchema;

export const sanitizeNameInput = (value: string) => value.replace(/[^\p{L} ]+/gu, '');
const emailSchema = authEmailSchema;

export const getEmailFormatError = (value: string) => {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
        return undefined;
    }

    return emailSchema.safeParse(trimmedValue).success ? undefined : EMAIL_FORMAT_MESSAGE;
};

// Registration schema
export const registerSchema = registerFormSchema;

export const kakaoOnboardingSchema = z.object({
    phone: phoneSchema,
    birthDate: birthDateSchema,
    role: z.enum(['admin', 'manager', 'user'], { message: '역할을 선택해주세요.' }),
});

// Login schema
export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, '비밀번호는 필수입니다.'),
});

// Forgot password schema
export const forgotPasswordSchema = z.object({
    email: emailSchema,
});

// Reset password schema
export const resetPasswordSchema = z.object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, '비밀번호 확인은 필수입니다.'),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: '비밀번호가 일치하지 않습니다.',
    path: ['confirmPassword'],
});

// Link password schema (for OAuth users adding password)
export const linkPasswordSchema = z.object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, '비밀번호 확인은 필수입니다.'),
}).refine((data) => data.password === data.confirmPassword, {
    message: '비밀번호가 일치하지 않습니다.',
    path: ['confirmPassword'],
});

// Type exports using Zod inference
export type { RegisterFormData };
export type KakaoOnboardingFormData = z.infer<typeof kakaoOnboardingSchema>;
export type LoginFormData = z.infer<typeof loginSchema>;
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;
export type LinkPasswordFormData = z.infer<typeof linkPasswordSchema>;

// Helper to get password requirements for UI display
export const passwordRequirements = [
    { label: '최소 8자 이상', regex: /.{8,}/ },
    { label: '소문자 포함', regex: /[a-z]/ },
    { label: '숫자 포함', regex: /[0-9]/ },
    { label: '특수문자 포함', regex: /[^A-Za-z0-9]/ },
];

// Utility to check password strength
export function checkPasswordStrength(password: string): {
    isValid: boolean;
    requirements: Array<{ label: string; met: boolean }>;
} {
    const requirements = passwordRequirements.map((req) => ({
        label: req.label,
        met: req.regex.test(password),
    }));

    return {
        isValid: requirements.every((req) => req.met),
        requirements,
    };
}
