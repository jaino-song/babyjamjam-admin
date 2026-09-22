import { NextRequest } from "next/server";
import { requestExpiredProblemResponse } from "@/lib/api/problem-responses";
/** Browser provider primitives are retired in favour of dispatch-headless. */
export async function POST(_request: NextRequest) {
    return requestExpiredProblemResponse("Use the server-mediated eformsign dispatch operation");
}
