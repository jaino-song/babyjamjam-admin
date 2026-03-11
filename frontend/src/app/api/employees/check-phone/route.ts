import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    console.error("[API] Error checking employee phone:", error);
    return NextResponse.json({ exists: false });
  }
}
