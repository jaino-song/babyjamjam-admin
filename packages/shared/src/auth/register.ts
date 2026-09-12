import { z } from "zod";

export const REGISTERABLE_ROLES = ["admin", "manager", "user"] as const;

export type RegisterableRole = (typeof REGISTERABLE_ROLES)[number];

export const REGISTERABLE_ROLE_OPTIONS: ReadonlyArray<{
  value: RegisterableRole;
  label: string;
}> = [
  { value: "admin", label: "지점장" },
  { value: "manager", label: "매니저" },
  { value: "user", label: "상담원" },
];

export const authPasswordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상으로 입력해 주세요.")
  .regex(/[A-Z]/, "비밀번호에 대문자를 넣어 주세요.")
  .regex(/[a-z]/, "비밀번호에 소문자를 넣어 주세요.")
  .regex(/[0-9]/, "비밀번호에 숫자를 넣어 주세요.")
  .regex(/[^A-Za-z0-9]/, "비밀번호에 특수문자를 넣어 주세요.");

export const authEmailSchema = z
  .string()
  .trim()
  .min(1, "이메일을 입력해 주세요.")
  .email("이메일 주소를 확인해 주세요.")
  .transform((email) => email.toLowerCase());

export const authNameSchema = z
  .string()
  .trim()
  .min(1, "이름을 입력해 주세요.")
  .regex(/^[\p{L} ]+$/u, "이름에는 숫자나 특수문자를 입력할 수 없어요.");

export const authPhoneSchema = z
  .string()
  .min(1, "전화번호를 입력해 주세요.")
  .regex(/^01[016789]-?\d{3,4}-?\d{4}$/, "전화번호 형식이 올바르지 않아요. 010-1234-5678처럼 입력해 주세요.");

export const authBirthDateSchema = z
  .string()
  .min(1, "생년월일을 입력해 주세요.")
  .regex(/^\d{4}-\d{2}-\d{2}$/, "생년월일 형식이 올바르지 않아요. 1990-01-01처럼 입력해 주세요.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
  }, "올바른 생년월일을 오늘보다 이전 날짜로 입력해 주세요.");

export const registerRequestSchema = z.object({
  email: authEmailSchema,
  password: authPasswordSchema,
  name: authNameSchema,
  phone: authPhoneSchema,
  birthDate: authBirthDateSchema,
});

export const registerFormSchema = registerRequestSchema
  .extend({
    confirmPassword: z.string().min(1, "확인할 비밀번호를 다시 입력해 주세요."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "비밀번호가 일치하지 않아요.",
    path: ["confirmPassword"],
  });

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type RegisterFormData = z.infer<typeof registerFormSchema>;
