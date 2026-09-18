import { NextRequest } from "next/server";
import { requestExpiredProblemResponse } from "@/lib/api/problem-responses";
/** Browser provider primitives are retired in favour of server-mediated jobs. */
export async function POST(_request: NextRequest) {
    return requestExpiredProblemResponse("eformsign provider operations are server-only");
}
