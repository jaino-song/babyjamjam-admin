import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

interface EmployeePhone {
  phone?: string | null;
}

interface PaginatedEmployeesResponse {
  data?: EmployeePhone[];
  total?: number;
  page?: number;
  limit?: number;
}

// GET /api/employees/check-phone?phone=01096411878
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const phone = request.nextUrl.searchParams.get("phone");
    if (!phone) {
      return NextResponse.json({ exists: false });
    }

    const targetDigits = phone.replace(/\D/g, "");
    if (targetDigits.length !== 11) {
      return NextResponse.json({ exists: false });
    }

    const response = await serverAPIClient.get<PaginatedEmployeesResponse | EmployeePhone[]>("/employees", {
      headers: getAuthHeaders(token),
    });

    const payload = response.data;
    const employees = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    const exists = employees.some(
      (employee) => (employee.phone ?? "").replace(/\D/g, "") === targetDigits,
    );

    return NextResponse.json({ exists });
  } catch (error) {
    // 업스트림 실패는 `exists: false`로 위장하지 않는다 — 폼의
    // 중복 확인 실패/재시도 UI가 동작하도록 sanitizer로 전달한다.
    return errorResponse(error, "check employee phone");
  }
}
