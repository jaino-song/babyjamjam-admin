import { NextRequest } from "next/server";
import { requestExpiredProblemResponse } from "@/lib/api/problem-responses";
/** Provider refresh is server-custodied; this legacy path is a tombstone. */
export async function POST(_request: NextRequest) {
    return requestExpiredProblemResponse("Raw eformsign credentials are not exposed");
}
