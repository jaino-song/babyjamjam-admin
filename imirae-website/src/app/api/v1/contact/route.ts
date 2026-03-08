import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRateLimited } from "@/lib/rate-limit";
import { sendContactEmail } from "@/lib/email";
import type { ApiErrorResponse, ApiSuccessResponse, ContactFormResponseData } from "@/types/api";

const contactSchema = z.object({
  name: z.string({ error: "이름을 입력해주세요." }).min(1, "이름을 입력해주세요.").max(50, "이름은 50자 이하로 입력해주세요."),
  email: z.string({ error: "이메일을 입력해주세요." }).email("올바른 이메일 주소를 입력해주세요.").max(254, "이메일이 너무 깁니다."),
  phone: z.string({ error: "연락처를 입력해주세요." }).regex(/^[0-9+\-\s]{9,20}$/, "올바른 전화번호를 입력해주세요."),
  subject: z.string({ error: "문의 유형을 선택해주세요." }).min(1, "문의 유형을 선택해주세요.").max(100, "제목은 100자 이하로 입력해주세요."),
  message: z.string({ error: "문의 내용을 입력해주세요." }).min(1, "문의 내용을 입력해주세요.").max(2000, "문의 내용은 2000자 이하로 입력해주세요."),
  privacyAgreed: z.literal(true, { error: "개인정보처리방침에 동의해주세요." }),
});

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    if (isRateLimited(ip)) {
      return NextResponse.json<ApiErrorResponse>(
        {
          success: false,
          data: null,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "잠시 후 다시 시도해주세요.",
          },
        },
        { status: 429 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ApiErrorResponse>(
        {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "올바른 요청 형식이 아닙니다.",
          },
        },
        { status: 400 }
      );
    }

    const result = contactSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field && typeof field === "string") {
          fieldErrors[field] = issue.message;
        }
      }

      return NextResponse.json<ApiErrorResponse>(
        {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "입력 정보를 확인해주세요.",
            details: { fieldErrors },
          },
        },
        { status: 400 }
      );
    }

    await sendContactEmail(result.data);

    return NextResponse.json<ApiSuccessResponse<ContactFormResponseData>>({
      success: true,
      data: { message: "문의가 성공적으로 접수되었습니다." },
      error: null,
    });
  } catch {
    return NextResponse.json<ApiErrorResponse>(
      {
        success: false,
        data: null,
        error: {
          code: "EMAIL_SEND_FAILED",
          message: "메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요.",
        },
      },
      { status: 500 }
    );
  }
}
