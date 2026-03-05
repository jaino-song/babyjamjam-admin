import { z } from 'zod';

// Password validation with detailed requirements
const passwordSchema = z
    .string()
    .min(8, '비밀번호는 최소 8자 이상이어야 합니다.')
    .regex(/[A-Z]/, '비밀번호에 대문자가 포함되어야 합니다.')
    .regex(/[a-z]/, '비밀번호에 소문자가 포함되어야 합니다.')
    .regex(/[0-9]/, '비밀번호에 숫자가 포함되어야 합니다.')
    .regex(/[^A-Za-z0-9]/, '비밀번호에 특수문자가 포함되어야 합니다.');

// Phone number validation (Korean format)
const phoneSchema = z
    .string()
    .min(1, '전화번호는 필수입니다.')
    .regex(/^01[016789]-?\d{3,4}-?\d{4}$/, '유효한 전화번호를 입력해주세요. (예: 010-1234-5678)');

// Birth date validation (YYYY-MM-DD)
const birthDateSchema = z
    .string()
    .min(1, '생년월일은 필수입니다.')
    .regex(/^\d{4}-\d{2}-\d{2}$/, '유효한 생년월일을 입력해주세요. (예: 1990-01-01)')
    .refine((date) => {
        const parsed = new Date(date);
        return !isNaN(parsed.getTime()) && parsed < new Date();
    }, '유효한 생년월일을 입력해주세요.');

// Registration schema
export const registerSchema = z.object({
    email: z
        .string()
        .min(1, '이메일은 필수입니다.')
        .email('유효한 이메일 주소를 입력해주세요.'),
    password: passwordSchema,
    confirmPassword: z.string().min(1, '비밀번호 확인은 필수입니다.'),
    name: z.string().min(1, '이름은 필수입니다.'),
    phone: phoneSchema,
    birthDate: birthDateSchema,
    organizationId: z.string().min(1, '지점을 선택해주세요.'),
    role: z.enum(['admin', 'manager', 'user'], { message: '역할을 선택해주세요.' }),
}).refine((data) => data.password === data.confirmPassword, {
    message: '비밀번호가 일치하지 않습니다.',
    path: ['confirmPassword'],
});

// Login schema
export const loginSchema = z.object({
    email: z
        .string()
        .min(1, '이메일은 필수입니다.')
        .email('유효한 이메일 주소를 입력해주세요.'),
    password: z.string().min(1, '비밀번호는 필수입니다.'),
});

// Forgot password schema
export const forgotPasswordSchema = z.object({
    email: z
        .string()
        .min(1, '이메일은 필수입니다.')
        .email('유효한 이메일 주소를 입력해주세요.'),
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
export type RegisterFormData = z.infer<typeof registerSchema>;
export type LoginFormData = z.infer<typeof loginSchema>;
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;
export type LinkPasswordFormData = z.infer<typeof linkPasswordSchema>;

// Helper to get password requirements for UI display
export const passwordRequirements = [
    { label: '최소 8자 이상', regex: /.{8,}/ },
    { label: '대문자 포함', regex: /[A-Z]/ },
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
