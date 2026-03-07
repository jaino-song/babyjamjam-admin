import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRateLimited } from "@/lib/rate-limit";
import { sendConsultationEmail } from "@/lib/email";
import type { ApiErrorResponse, ApiSuccessResponse, ConsultationResponseData } from "@/types/api";

const consultationSchema = z.object({
  name: z.string({ error: "이름을 입력해주세요." }).min(1, "이름을 입력해주세요.").max(50, "이름은 50자 이하로 입력해주세요."),
  phone: z.string({ error: "연락처를 입력해주세요." }).regex(/^[0-9+\-\s]{9,20}$/, "올바른 전화번호를 입력해주세요."),
  dueDate: z.string().date("올바른 날짜 형식이 아닙니다 (YYYY-MM-DD).").optional(),
  message: z.string().max(500, "메시지는 500자 이하로 입력해주세요.").optional(),
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

    const result = consultationSchema.safeParse(body);

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

    await sendConsultationEmail(result.data);

    return NextResponse.json<ApiSuccessResponse<ConsultationResponseData>>({
      success: true,
      data: { message: "상담 신청이 접수되었습니다. 빠른 시일 내에 연락드리겠습니다." },
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
