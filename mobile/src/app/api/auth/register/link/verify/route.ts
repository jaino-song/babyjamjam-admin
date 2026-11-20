import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, parseBody } from "@/lib/api/route-utils";

const schema = z.object({ challengeToken: z.string().min(1), code: z.string().regex(/^\d{6}$/) });
export async function POST(request: NextRequest) {
  const { data, response } = await parseBody(schema, request);
  if (response) return response;
  try {
    const result = await serverAPIClient.post("/auth/register/link/verify", data);
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) { return errorResponse(error, "verify register link"); }
}
