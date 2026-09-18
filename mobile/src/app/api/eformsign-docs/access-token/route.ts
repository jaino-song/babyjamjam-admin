import { NextRequest } from "next/server";
import { requestExpiredProblemResponse } from "@/lib/api/problem-responses";
/** Legacy provider token path retained as a deterministic tombstone. */
export async function POST(_request: NextRequest) {
    return requestExpiredProblemResponse("Raw eformsign credentials are not exposed");
}
