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
  .min(8, "비밀번호는 최소 8자 이상이어야 합니다.")
  .regex(/[A-Z]/, "비밀번호에 대문자가 포함되어야 합니다.")
  .regex(/[a-z]/, "비밀번호에 소문자가 포함되어야 합니다.")
  .regex(/[0-9]/, "비밀번호에 숫자가 포함되어야 합니다.")
  .regex(/[^A-Za-z0-9]/, "비밀번호에 특수문자가 포함되어야 합니다.");

export const authEmailSchema = z
  .string()
  .trim()
  .min(1, "이메일은 필수입니다.")
  .email("이메일 주소를 확인해 주세요.")
  .transform((email) => email.toLowerCase());

export const authNameSchema = z
  .string()
  .trim()
  .min(1, "이름은 필수입니다.")
  .regex(/^[\p{L} ]+$/u, "이름에는 숫자나 특수문자를 입력할 수 없습니다.");

export const authPhoneSchema = z
  .string()
  .min(1, "전화번호는 필수입니다.")
  .regex(/^01[016789]-?\d{3,4}-?\d{4}$/, "유효한 전화번호를 입력해주세요. (예: 010-1234-5678)");

export const authBirthDateSchema = z
  .string()
  .min(1, "생년월일은 필수입니다.")
  .regex(/^\d{4}-\d{2}-\d{2}$/, "유효한 생년월일을 입력해주세요. (예: 1990-01-01)")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
  }, "유효한 생년월일을 입력해주세요.");

export const registerRequestSchema = z.object({
  email: authEmailSchema,
  password: authPasswordSchema,
  name: authNameSchema,
  phone: authPhoneSchema,
  birthDate: authBirthDateSchema,
  branchId: z.string().uuid("유효한 지점을 선택해주세요."),
  role: z.enum(REGISTERABLE_ROLES, { message: "역할을 선택해주세요." }),
});

export const registerFormSchema = registerRequestSchema
  .extend({
    confirmPassword: z.string().min(1, "비밀번호 확인은 필수입니다."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "비밀번호가 일치하지 않습니다.",
    path: ["confirmPassword"],
  });

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type RegisterFormData = z.infer<typeof registerFormSchema>;
